/**
 * 用户管理路由（仅管理员）
 */
const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const { getUsers, getUserByUsername, getUserById, createUser, updateUser, deleteUser } = require('../utils/db');
const { getDepartments, getDepartmentById } = require('../utils/materials');
const { addOpLog } = require('../utils/logger');
const { requireAdmin } = require('../utils/middleware');

// 文件上传配置（批量导入）
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, 'users_import_' + Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('只支持 .xlsx / .xls 文件'));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

function uploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// 用户列表（包含部门信息）
router.get('/', requireAdmin, (req, res) => {
  const depts = getDepartments();
  const deptMap = new Map(depts.map(d => [d.id, d.name]));
  
  const users = getUsers().map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    departmentId: u.departmentId,
    departmentName: deptMap.get(u.departmentId) || '未分配',
    createdAt: u.createdAt,
  }));
  res.json(users);
});

// 添加用户（支持部门）
router.post('/', requireAdmin, (req, res) => {
  const { username, password, role = 'user', departmentId } = req.body;

  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 6 || password.length > 50) return res.status(400).json({ error: '密码长度需在 6~50 位之间' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: '角色无效' });

  const exists = getUserByUsername(username);
  if (exists) return res.status(409).json({ error: '用户名已存在' });

  // 验证部门是否存在
  if (departmentId) {
    const dept = getDepartmentById(departmentId);
    if (!dept) return res.status(400).json({ error: '部门不存在' });
  }

  const user = createUser(username, password, role, departmentId || null);
  
  const deptName = departmentId ? getDepartmentById(departmentId)?.name : '未分配';
  addOpLog({ 
    username: req.session.username, 
    action: 'create-user', 
    detail: `新建用户: ${username} (${role}, ${deptName})` 
  });

  res.json({ 
    success: true, 
    user: { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      departmentId: user.departmentId,
      departmentName: deptName,
      createdAt: user.createdAt 
    } 
  });
});

// 更新用户信息（部门、角色）
router.put('/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { departmentId, role } = req.body;
  
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  
  // 不能修改自己的角色
  if (id === req.session.userId && role && role !== user.role) {
    return res.status(400).json({ error: '不能修改自己的角色' });
  }
  
  const updates = {};
  if (departmentId !== undefined) {
    if (departmentId) {
      const dept = getDepartmentById(departmentId);
      if (!dept) return res.status(400).json({ error: '部门不存在' });
    }
    updates.departmentId = departmentId || null;
  }
  if (role && ['admin', 'user'].includes(role)) {
    updates.role = role;
  }
  
  const updated = updateUser(id, updates);
  const deptName = updated.departmentId ? getDepartmentById(updated.departmentId)?.name : '未分配';
  
  addOpLog({ 
    username: req.session.username, 
    action: 'update-user', 
    detail: `更新用户: ${updated.username}` 
  });
  
  res.json({ 
    success: true, 
    user: {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      departmentId: updated.departmentId,
      departmentName: deptName,
      createdAt: updated.createdAt,
    }
  });
});

// 管理员重置用户密码
router.put('/:id/password', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  
  if (!password || password.length < 6 || password.length > 50) {
    return res.status(400).json({ error: '密码长度需在 6~50 位之间' });
  }
  
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  
  // 不能修改自己的密码（管理员应使用修改密码功能）
  if (id === req.session.userId) {
    return res.status(400).json({ error: '不能通过此接口修改自己的密码，请使用"修改密码"功能' });
  }
  
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(password, 10);
  updateUser(id, { password: hash });
  
  addOpLog({ 
    username: req.session.username, 
    action: 'reset-password', 
    detail: `重置用户密码: ${user.username}` 
  });
  
  res.json({ success: true, message: '密码重置成功' });
});

// 删除用户
router.delete('/:id', requireAdmin, (req, res) => {
  const { id } = req.params;

  // 不允许删除自己
  if (id === req.session.userId) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }

  const target = getUserById(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  deleteUser(id);
  addOpLog({ username: req.session.username, action: 'delete-user', detail: `删除用户: ${target.username}` });

  res.json({ success: true });
});

// 批量删除用户
router.post('/batch-delete', requireAdmin, (req, res) => {
  const { ids } = req.body;
  
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请选择要删除的用户' });
  }
  
  let deleted = 0;
  let skipped = 0;
  
  for (const id of ids) {
    if (id === req.session.userId) {
      skipped++;
      continue;
    }
    const target = getUserById(id);
    if (target) {
      deleteUser(id);
      deleted++;
    }
  }
  
  addOpLog({ 
    username: req.session.username, 
    action: 'batch-delete-users', 
    detail: `批量删除用户: ${deleted} 个成功, ${skipped} 个跳过` 
  });
  
  res.json({ success: true, deleted, skipped });
});

// 批量导入用户（Excel）
router.post('/import', requireAdmin, uploadMiddleware, (req, res) => {
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    if (data.length < 2) {
      return res.status(400).json({ error: 'Excel 文件为空或格式不正确，至少需要包含表头和一行数据' });
    }
    
    // 标准化表头（去除空格、转小写）
    const headers = data[0].map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, ''));
    
    // 更灵活的列名匹配
    const usernameIdx = headers.findIndex(h => /用户名|账号|姓名|user(name)?|login/i.test(h));
    const passwordIdx = headers.findIndex(h => /密码|初始密码|pwd|password/i.test(h));
    const roleIdx = headers.findIndex(h => /角色|权限|role|身份/i.test(h));
    const deptIdx = headers.findIndex(h => /部门|dept|department|科室|小组/i.test(h));
    
    if (usernameIdx === -1) {
      return res.status(400).json({ 
        error: '未找到用户名列，请确保列名包含"用户名"、"账号"、"姓名"、"username"等关键字',
        detectedHeaders: data[0]
      });
    }
    
    const depts = getDepartments();
    const deptMap = new Map(depts.map(d => [d.name, d.id]));
    
    const results = { success: 0, failed: 0, errors: [] };
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const username = String(row[usernameIdx] || '').trim();
      
      if (!username) continue;
      
      // 检查用户是否已存在
      if (getUserByUsername(username)) {
        results.failed++;
        results.errors.push(`第 ${i + 1} 行: 用户名 "${username}" 已存在`);
        continue;
      }
      
      const password = passwordIdx >= 0 ? String(row[passwordIdx] || '').trim() : '123456';
      if (password.length < 6) {
        results.failed++;
        results.errors.push(`第 ${i + 1} 行: 用户名 "${username}" 的密码太短`);
        continue;
      }
      
      let role = 'user';
      if (roleIdx >= 0) {
        const roleVal = String(row[roleIdx] || '').trim().toLowerCase();
        if (roleVal === 'admin' || roleVal === '管理员') role = 'admin';
      }
      
      let departmentId = null;
      if (deptIdx >= 0) {
        const deptName = String(row[deptIdx] || '').trim();
        departmentId = deptMap.get(deptName) || null;
      }
      
      createUser(username, password, role, departmentId);
      results.success++;
    }
    
    addOpLog({ 
      username: req.session.username, 
      action: 'import-users', 
      detail: `批量导入用户: ${results.success} 个成功, ${results.failed} 个失败` 
    });
    
    res.json({ 
      success: true, 
      imported: results.success,
      failed: results.failed,
      errors: results.errors.slice(0, 10) // 最多返回10个错误
    });
    
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 导出用户列表（Excel）
router.get('/export', requireAdmin, (req, res) => {
  const depts = getDepartments();
  const deptMap = new Map(depts.map(d => [d.id, d.name]));
  
  const users = getUsers().map(u => ({
    用户名: u.username,
    角色: u.role === 'admin' ? '管理员' : '普通用户',
    部门: deptMap.get(u.departmentId) || '未分配',
    创建时间: u.createdAt,
  }));
  
  const worksheet = xlsx.utils.json_to_sheet(users);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, '用户列表');
  
  const exportPath = path.join(__dirname, '..', 'uploads', `users_export_${Date.now()}.xlsx`);
  xlsx.writeFile(workbook, exportPath);
  
  addOpLog({ 
    username: req.session.username, 
    action: 'export-users', 
    detail: `导出用户列表: ${users.length} 人` 
  });
  
  res.download(exportPath, `用户列表_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// 下载导入模板
router.get('/template', requireAdmin, (req, res) => {
  try {
    // 获取当前部门列表作为示例
    const depts = getDepartments();
    const deptExamples = depts.length > 0 ? depts.slice(0, 3).map(d => d.name) : ['技术部', '财务部', '管理部'];
    
    const template = [
      { 用户名: 'zhangsan', 密码: '123456', 角色: 'user', 部门: deptExamples[0] || '技术部' },
      { 用户名: 'lisi', 密码: '123456', 角色: 'user', 部门: deptExamples[1] || '财务部' },
      { 用户名: 'wangwu', 密码: '123456', 角色: 'admin', 部门: deptExamples[2] || '管理部' },
    ];
    
    const worksheet = xlsx.utils.json_to_sheet(template);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, '导入模板');
    
    // 确保 uploads 目录存在
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!require('fs').existsSync(uploadsDir)) {
      require('fs').mkdirSync(uploadsDir, { recursive: true });
    }
    
    const exportPath = path.join(uploadsDir, 'users_template.xlsx');
    xlsx.writeFile(workbook, exportPath);
    
    res.download(exportPath, '用户导入模板.xlsx', (err) => {
      if (err) {
        console.error('下载模板失败:', err);
        res.status(500).json({ error: '下载失败: ' + err.message });
      }
    });
  } catch (err) {
    console.error('生成模板失败:', err);
    res.status(500).json({ error: '生成模板失败: ' + err.message });
  }
});

module.exports = router;