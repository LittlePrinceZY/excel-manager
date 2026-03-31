/**
 * 物资申报管理路由
 */
const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const { 
  getMaterials, parseMaterialsExcel, saveMaterials, addMaterial, updateMaterial, deleteMaterial,
  getApplications, getApplicationsByUser, getApplicationsByDepartment,
  createApplication, updateApplication, deleteApplication,
  getDepartments, getDepartmentById, getDepartmentRemainingQuota,
  getDepartmentUsedQuota, getBroadcast, setBroadcast,
  getMaterialsEnabled, setMaterialsEnabled
} = require('../utils/materials');
const { getUserById } = require('../utils/db');
const { addOpLog } = require('../utils/logger');
const { requireLogin, requireAdmin } = require('../utils/middleware');

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'data', 'uploads')),
  filename: (req, file, cb) => cb(null, 'materials_' + Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('只支持 .xlsx / .xls 文件'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// ========== 物资清单管理 ==========

// 获取当前物资清单
router.get('/list', requireLogin, (req, res) => {
  const materials = getMaterials();
  res.json({ success: true, materials });
});

// 获取广播内容
router.get('/broadcast', requireLogin, (req, res) => {
  const broadcast = getBroadcast();
  res.json({ success: true, broadcast });
});

// 获取物资申领开关状态
router.get('/settings', requireLogin, (req, res) => {
  const settings = getMaterialsEnabled();
  res.json({ success: true, settings });
});

// 设置物资申领开关（管理员）
router.post('/settings', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  const settings = setMaterialsEnabled(enabled, req.session.username);
  addOpLog({ 
    username: req.session.username, 
    action: 'update-materials-settings', 
    detail: `设置物资申领开关: ${enabled ? '开启' : '关闭'}` 
  });
  res.json({ success: true, settings });
});

// 设置广播内容（管理员）
router.post('/broadcast', requireAdmin, (req, res) => {
  const { content } = req.body;
  const broadcast = setBroadcast(content, req.session.username);
  addOpLog({ 
    username: req.session.username, 
    action: 'update-broadcast', 
    detail: '更新物资申领广播内容' 
  });
  res.json({ success: true, broadcast });
});

// 上传物资清单Excel（管理员）
router.post('/upload', requireAdmin, uploadMiddleware, (req, res) => {
  try {
    const materials = parseMaterialsExcel(req.file.path);
    saveMaterials(materials, req.session.username);
    
    addOpLog({ 
      username: req.session.username, 
      action: 'upload-materials', 
      detail: `上传物资清单，共 ${materials.length} 条记录` 
    });
    
    res.json({ success: true, count: materials.length, materials });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 手动添加物资（管理员）
router.post('/material', requireAdmin, (req, res) => {
  const { name, price, spec } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: '物资名称不能为空' });
  }
  
  const material = addMaterial(name, price, spec, req.session.username);
  
  addOpLog({ 
    username: req.session.username, 
    action: 'add-material', 
    detail: `手动添加物资: ${name}, 单价: ¥${price}` 
  });
  
  res.json({ success: true, material });
});

// 更新物资（管理员）
router.put('/material/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, price, spec } = req.body;
  
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (price !== undefined) updates.price = parseFloat(price) || 0;
  if (spec !== undefined) updates.spec = spec.trim();
  
  const material = updateMaterial(id, updates);
  if (!material) return res.status(404).json({ error: '物资不存在' });
  
  addOpLog({ 
    username: req.session.username, 
    action: 'update-material', 
    detail: `更新物资: ${material.name}` 
  });
  
  res.json({ success: true, material });
});

// 删除物资（管理员）
router.delete('/material/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  
  const material = getMaterials().find(m => m.id === id);
  if (!material) return res.status(404).json({ error: '物资不存在' });
  
  deleteMaterial(id);
  
  addOpLog({ 
    username: req.session.username, 
    action: 'delete-material', 
    detail: `删除物资: ${material.name}` 
  });
  
  res.json({ success: true });
});

// ========== 申领管理 ==========

// 获取当前用户的申领记录
router.get('/my-applications', requireLogin, (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  
  // 获取用户自己的申领
  let applications = getApplicationsByUser(req.session.userId);
  
  // 如果是普通用户，还能看到同部门其他人的申领（只读）
  if (user.role === 'user' && user.departmentId) {
    const deptApps = getApplicationsByDepartment(user.departmentId);
    // 合并，标记是否是自己的
    const myIds = new Set(applications.map(a => a.id));
    const otherApps = deptApps.filter(a => !myIds.has(a.id)).map(a => ({ ...a, isReadOnly: true }));
    applications = [...applications, ...otherApps];
  }
  
  // 补充物资名称和用户信息
  const materials = getMaterials();
  applications = applications.map(app => {
    const material = materials.find(m => m.id === app.materialId);
    const appUser = getUserById(app.userId);
    const dept = getDepartmentById(app.departmentId);
    return {
      ...app,
      materialName: material?.name || '未知物资',
      materialSpec: material?.spec || '',
      materialPrice: material?.price || 0,
      username: appUser?.username || '未知用户',
      departmentName: dept?.name || '未知部门',
    };
  });
  
  res.json({ success: true, applications });
});

// 获取部门额度信息
router.get('/quota', requireLogin, (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user || !user.departmentId) {
    return res.json({ success: true, quota: 0, used: 0, remaining: 0 });
  }
  
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const dept = getDepartmentById(user.departmentId);
  const quota = dept?.quota || 0;
  const used = getDepartmentUsedQuota(user.departmentId, month);
  const remaining = quota - used;
  
  res.json({ 
    success: true, 
    quota, 
    used, 
    remaining,
    departmentName: dept?.name || ''
  });
});

// 创建申领（普通用户）
router.post('/apply', requireLogin, (req, res) => {
  const { materialId, quantity, remark, applicantName } = req.body;
  
  // 检查物资申领是否开启
  const settings = getMaterialsEnabled();
  if (!settings.enabled) {
    return res.status(403).json({ error: '物资申领功能已关闭，暂无法提交申请' });
  }
  
  if (!materialId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '请选择物资并输入有效数量' });
  }
  
  if (!applicantName || applicantName.trim().length === 0) {
    return res.status(400).json({ error: '请填写申领人' });
  }
  
  const user = getUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  
  if (!user.departmentId) {
    return res.status(400).json({ error: '您尚未分配部门，请联系管理员' });
  }
  
  const material = getMaterials().find(m => m.id === materialId);
  if (!material) return res.status(404).json({ error: '物资不存在' });
  
  const month = new Date().toISOString().slice(0, 7);
  const remaining = getDepartmentRemainingQuota(user.departmentId, month);
  const totalAmount = material.price * quantity;
  
  if (totalAmount > remaining) {
    return res.status(400).json({ 
      error: `部门额度不足，剩余额度: ¥${remaining.toFixed(2)}，本次申请: ¥${totalAmount.toFixed(2)}` 
    });
  }
  
  const application = createApplication({
    userId: req.session.userId,
    departmentId: user.departmentId,
    materialId,
    materialName: material.name,
    materialSpec: material.spec,
    materialPrice: material.price,
    quantity: parseInt(quantity),
    totalAmount,
    applicantName: applicantName.trim(),
    remark: remark || '',
    month,
  });
  
  addOpLog({ 
    username: req.session.username, 
    action: 'apply-material', 
    detail: `申领物资: ${material.name} x${quantity}, 申领人: ${applicantName.trim()}, 金额: ¥${totalAmount.toFixed(2)}` 
  });
  
  res.json({ success: true, application });
});

// ========== 管理员功能 ==========

// 获取所有申领（管理员）
router.get('/all-applications', requireAdmin, (req, res) => {
  let applications = getApplications();
  const materials = getMaterials();
  const depts = getDepartments();
  
  applications = applications.map(app => {
    const material = materials.find(m => m.id === app.materialId);
    const user = getUserById(app.userId);
    const dept = depts.find(d => d.id === app.departmentId);
    return {
      ...app,
      materialName: material?.name || '未知物资',
      materialSpec: material?.spec || '',
      materialPrice: material?.price || 0,
      username: user?.username || '未知用户',
      departmentName: dept?.name || '未知部门',
    };
  });
  
  res.json({ success: true, applications });
});

// 更新申领状态（管理员）
router.put('/applications/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: '无效的状态' });
  }
  
  const app = updateApplication(id, { status });
  if (!app) return res.status(404).json({ error: '申领记录不存在' });
  
  addOpLog({ 
    username: req.session.username, 
    action: 'update-application', 
    detail: `更新申领状态: ${app.materialName} -> ${status}` 
  });
  
  res.json({ success: true, application: app });
});

// 删除申领（管理员）
router.delete('/applications/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const app = getApplications().find(a => a.id === id);
  
  if (!app) return res.status(404).json({ error: '申领记录不存在' });
  
  deleteApplication(id);
  
  addOpLog({ 
    username: req.session.username, 
    action: 'delete-application', 
    detail: `删除申领: ${app.materialName}` 
  });
  
  res.json({ success: true });
});

// 按部门统计
router.get('/statistics', requireAdmin, (req, res) => {
  const { month } = req.query;
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  
  const depts = getDepartments();
  const applications = getApplications().filter(a => a.month === targetMonth && a.status !== 'rejected');
  
  const stats = depts.map(dept => {
    const deptApps = applications.filter(a => a.departmentId === dept.id);
    const totalAmount = deptApps.reduce((sum, a) => sum + (a.totalAmount || 0), 0);
    const totalCount = deptApps.reduce((sum, a) => sum + (a.quantity || 0), 0);
    
    return {
      departmentId: dept.id,
      departmentName: dept.name,
      quota: dept.quota || 0,
      used: totalAmount,
      remaining: (dept.quota || 0) - totalAmount,
      applicationCount: deptApps.length,
      itemCount: totalCount,
    };
  });
  
  res.json({ success: true, month: targetMonth, statistics: stats });
});

module.exports = router;