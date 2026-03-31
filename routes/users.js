/**
 * 用户管理路由（仅管理员）
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getUsers, getUserByUsername, createUser, deleteUser } = require('../utils/db');
const { addOpLog } = require('../utils/logger');
const { requireAdmin } = require('../utils/middleware');

// 用户列表
router.get('/', requireAdmin, (req, res) => {
  const users = getUsers().map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
  }));
  res.json(users);
});

// 添加用户
router.post('/', requireAdmin, (req, res) => {
  const { username, password, role = 'user' } = req.body;

  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 6 || password.length > 50) return res.status(400).json({ error: '密码长度需在 6~50 位之间' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: '角色无效' });

  const exists = getUserByUsername(username);
  if (exists) return res.status(409).json({ error: '用户名已存在' });

  const user = createUser(username, password, role);
  addOpLog({ username: req.session.username, action: 'create-user', detail: `新建用户: ${username} (${role})` });

  res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt } });
});

// 删除用户
router.delete('/:id', requireAdmin, (req, res) => {
  const { id } = req.params;

  // 不允许删除自己
  if (id === req.session.userId) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }

  const { getUserById } = require('../utils/db');
  const target = getUserById(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  deleteUser(id);
  addOpLog({ username: req.session.username, action: 'delete-user', detail: `删除用户: ${target.username}` });

  res.json({ success: true });
});

module.exports = router;
