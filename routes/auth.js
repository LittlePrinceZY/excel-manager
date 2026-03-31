/**
 * 认证路由：登录、登出、改密、当前用户
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getUserByUsername, updateUser } = require('../utils/db');
const { addLoginLog, addOpLog } = require('../utils/logger');
const { requireLogin, getClientIP } = require('../utils/middleware');

const LOCK_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// 登录
router.post('/login', async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const ip = getClientIP(req);

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = getUserByUsername(username);

  if (!user) {
    addLoginLog({ username, ip, result: 'fail', reason: '用户不存在' });
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  // 检查锁定
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const remaining = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
    addLoginLog({ username, ip, result: 'fail', reason: `账号锁定中` });
    return res.status(423).json({ error: `账号已锁定，请 ${remaining} 分钟后再试` });
  }

  const valid = bcrypt.compareSync(password, user.password);

  if (!valid) {
    const attempts = (user.loginAttempts || 0) + 1;
    const fields = { loginAttempts: attempts };
    if (attempts >= LOCK_ATTEMPTS) {
      fields.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
      fields.loginAttempts = 0;
    }
    updateUser(user.id, fields);
    addLoginLog({ username, ip, result: 'fail', reason: '密码错误' });
    const left = LOCK_ATTEMPTS - attempts;
    if (left <= 0) return res.status(423).json({ error: `密码错误次数过多，账号已锁定 ${LOCK_MINUTES} 分钟` });
    return res.status(401).json({ error: `用户名或密码错误，还有 ${left} 次机会` });
  }

  // 登录成功
  updateUser(user.id, { loginAttempts: 0, lockedUntil: null });

  if (rememberMe) {
    req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7天
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.departmentId = user.departmentId || null;

  addLoginLog({ username: user.username, ip, result: 'success', reason: '' });

  res.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

// 登出
router.post('/logout', (req, res) => {
  const username = req.session?.username || 'unknown';
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    addOpLog({ username, action: 'logout', detail: '' });
    res.json({ success: true });
  });
});

// 获取当前登录用户
router.get('/me', requireLogin, (req, res) => {
  const { getUserById } = require('../utils/db');
  const user = getUserById(req.session.userId);
  res.json({
    id: req.session.userId,
    username: req.session.username,
    role: req.session.role,
    departmentId: user?.departmentId || null,
  });
});

// 修改密码（需要登录）
router.post('/change-password', requireLogin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const { getUserById } = require('../utils/db');

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '参数不完整' });
  }
  if (newPassword.length < 6 || newPassword.length > 50) {
    return res.status(400).json({ error: '密码长度需在 6~50 位之间' });
  }

  const user = getUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  if (!bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(400).json({ error: '原密码错误' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  updateUser(user.id, { password: hash });

  addOpLog({ username: user.username, action: 'change-password', detail: '' });

  // 销毁 session，强制重新登录
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true, message: '密码修改成功，请重新登录' });
  });
});

module.exports = router;
