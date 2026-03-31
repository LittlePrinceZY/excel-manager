/**
 * 部门管理路由（仅管理员）
 */
const router = require('express').Router();
const { 
  getDepartments, getDepartmentById, getDepartmentByName,
  createDepartment, updateDepartment, deleteDepartment 
} = require('../utils/materials');
const { getUsersByDepartment, updateUser } = require('../utils/db');
const { addOpLog } = require('../utils/logger');
const { requireAdmin } = require('../utils/middleware');

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

module.exports = router;