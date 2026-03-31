/**
 * Excel 文件管理系统 - 主服务入口
 */
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 初始化目录
const DIRS = {
  data: path.join(__dirname, 'data'),
  uploads: path.join(__dirname, 'data', 'uploads'),
  sessions: path.join(__dirname, 'data', 'sessions'),
  logs: path.join(__dirname, 'data', 'logs'),
};
Object.values(DIRS).forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// 生成/读取 session 密钥
const SECRET_FILE = path.join(DIRS.data, '.secret');
let SESSION_SECRET;
if (fs.existsSync(SECRET_FILE)) {
  SESSION_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  SESSION_SECRET = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(SECRET_FILE, SESSION_SECRET, { mode: 0o600 });
}

// 初始化应用
const app = express();

// 路由模块（在 session 配置前引入）
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const excelRouter = require('./routes/excel');
const logsRouter = require('./routes/logs');
const materialsRouter = require('./routes/materials');
const departmentsRouter = require('./routes/departments');

// 中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  store: new FileStore({ path: DIRS.sessions, ttl: 86400 * 7, retries: 1 }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: null, // 默认浏览器关闭失效
    sameSite: 'lax',
  }
}));

// 路由
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/excel', excelRouter);
app.use('/api/logs', logsRouter);
app.use('/api/materials', materialsRouter);
app.use('/api/departments', departmentsRouter);

// SPA 回退
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动时迁移明文密码
require('./utils/migrate')();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ ZY管理系统已启动: http://localhost:${PORT}`);
});
