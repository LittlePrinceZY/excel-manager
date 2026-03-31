/**
 * 日志查看路由（仅管理员）
 */
const router = require('express').Router();
const { getLoginLogs, getOpLogs } = require('../utils/logger');
const { requireAdmin } = require('../utils/middleware');

router.get('/login', requireAdmin, (req, res) => {
  res.json(getLoginLogs());
});

router.get('/operations', requireAdmin, (req, res) => {
  res.json(getOpLogs());
});

module.exports = router;
