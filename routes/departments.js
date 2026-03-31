/**
 * 部门管理路由（仅管理员）
 */
const router = require('express').Router();
const xlsx = require('xlsx');
const path = require('path');
const multer = require('multer');
const { 
  getDepartments, getDepartmentById, getDepartmentByName,
  createDepartment, updateDepartment, deleteDepartment 
} = require('../utils/materials');
const { getUsersByDepartment, updateUser } = require('../utils/db');
const { addOpLog } = require('../utils/logger');
const { requireAdmin } = require('../utils/middleware');

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'data', 'uploads')),
  filename: (req, file, cb) => cb(null, 'dept_import_' + Date.now() + path.extname(file.originalname)),
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

// 部门列表
router.get('/', requireAdmin, (req, res) => {
  const departments = getDepartments();
  res.json({ success: true, departments });
});

// 创建部门
router.post('/', requireAdmin, (req, res) => {
  const { name, quota = 0 } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: '部门名称不能为空' });
  }
  
  const exists = getDepartmentByName(name.trim());
  if (exists) {
    return res.status(409).json({ error: '部门名称已存在' });
  }
  
  const dept = createDepartment(name.trim(), parseFloat(quota) || 0);
  
  addOpLog({ 
    username: req.session.username, 
    action: 'create-department', 
    detail: `创建部门: ${name}, 额度: ¥${quota}` 
  });
  
  res.json({ success: true, department: dept });
});

// 更新部门
router.put('/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, quota } = req.body;
  
  const dept = getDepartmentById(id);
  if (!dept) {
    return res.status(404).json({ error: '部门不存在' });
  }
  
  const updates = {};
  if (name !== undefined) {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return res.status(400).json({ error: '部门名称不能为空' });
    }
    const exists = getDepartmentByName(trimmed);
    if (exists && exists.id !== id) {
      return res.status(409).json({ error: '部门名称已存在' });
    }
    updates.name = trimmed;
  }
  if (quota !== undefined) {
    updates.quota = parseFloat(quota) || 0;
  }
  
  const updated = updateDepartment(id, updates);
  
  addOpLog({ 
    username: req.session.username, 
    action: 'update-department', 
    detail: `更新部门: ${updated.name}` 
  });
  
  res.json({ success: true, department: updated });
});

// 删除部门
router.delete('/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  
  const dept = getDepartmentById(id);
  if (!dept) {
    return res.status(404).json({ error: '部门不存在' });
  }
  
  // 检查是否有用户属于该部门
  const users = getUsersByDepartment(id);
  if (users.length > 0) {
    return res.status(400).json({ 
      error: `该部门下还有 ${users.length} 名用户，请先转移或删除这些用户` 
    });
  }
  
  deleteDepartment(id);
  
  addOpLog({ 
    username: req.session.username, 
    action: 'delete-department', 
    detail: `删除部门: ${dept.name}` 
  });
  
  res.json({ success: true });
});

// 批量导入部门（Excel）
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
    const nameIdx = headers.findIndex(h => /部门名称|部门|名称|name|dept/i.test(h));
    const quotaIdx = headers.findIndex(h => /额度|预算|限额|quota|预算额度|月度额度/i.test(h));
    
    if (nameIdx === -1) {
      return res.status(400).json({ 
        error: '未找到部门名称列，请确保列名包含"部门名称"、"部门"、"name"等关键字',
        detectedHeaders: data[0]
      });
    }
    
    const results = { success: 0, failed: 0, updated: 0, errors: [] };
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const name = String(row[nameIdx] || '').trim();
      
      if (!name) continue;
      
      // 解析额度
      let quota = 0;
      if (quotaIdx >= 0) {
        const quotaVal = row[quotaIdx];
        if (quotaVal !== undefined && quotaVal !== null && quotaVal !== '') {
          quota = parseFloat(quotaVal) || 0;
        }
      }
      
      // 检查部门是否已存在
      const existingDept = getDepartmentByName(name);
      if (existingDept) {
        // 更新现有部门的额度
        if (quota > 0 && quota !== existingDept.quota) {
          updateDepartment(existingDept.id, { quota });
          results.updated++;
        } else {
          results.failed++;
          results.errors.push(`第 ${i + 1} 行: 部门 "${name}" 已存在`);
        }
        continue;
      }
      
      // 创建新部门
      createDepartment(name, quota);
      results.success++;
    }
    
    addOpLog({ 
      username: req.session.username, 
      action: 'import-departments', 
      detail: `批量导入部门: ${results.success} 个新增, ${results.updated} 个更新, ${results.failed} 个失败` 
    });
    
    res.json({ 
      success: true, 
      imported: results.success,
      updated: results.updated,
      failed: results.failed,
      errors: results.errors.slice(0, 10) // 最多返回10个错误
    });
    
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 下载部门导入模板
router.get('/template', requireAdmin, (req, res) => {
  try {
    const template = [
      { 部门名称: '技术部', 月度额度: 10000 },
      { 部门名称: '财务部', 月度额度: 8000 },
      { 部门名称: '人力资源部', 月度额度: 5000 },
      { 部门名称: '市场部', 月度额度: 15000 },
      { 部门名称: '运营部', 月度额度: 12000 },
    ];
    
    const worksheet = xlsx.utils.json_to_sheet(template);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, '导入模板');
    
    // 确保 uploads 目录存在
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!require('fs').existsSync(uploadsDir)) {
      require('fs').mkdirSync(uploadsDir, { recursive: true });
    }
    
    const exportPath = path.join(uploadsDir, 'departments_template.xlsx');
    xlsx.writeFile(workbook, exportPath);
    
    res.download(exportPath, '部门导入模板.xlsx', (err) => {
      if (err) {
        console.error('下载模板失败:', err);
        res.status(500).json({ error: '下载失败: ' + err.message });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;