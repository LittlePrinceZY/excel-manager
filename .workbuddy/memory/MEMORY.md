# Working Memory - Excel管理系统项目

## 项目：Excel数据管理系统

**日期**：2026-03-31  
**状态**：完成构建，本地运行验证通过

### 技术栈
- 后端：Node.js + Express + express-session + session-file-store
- 数据存储：JSON文件（users.json, files.json）+ 上传Excel文件
- 前端：原生HTML/CSS/JS（单页应用，无框架）
- 加密：bcryptjs (salt=10)
- 文件上传：multer v2

### 项目路径
`c:\Users\Administrator\WorkBuddy\20260331083046\`

### 默认账号
- 用户名：Admin，初始密码：123456

### 已实现功能
- 双角色（admin/user）+ 登录锁定（5次/15分钟）+ 记住我7天
- bcryptjs密码加密 + 明文密码自动迁移
- 修改密码后强制重新登录
- Excel上传/查看/编辑/删除/重命名/导出（xlsx+csv）
- 模糊全字段搜索
- 登录日志（500条）+ 操作日志（1000条）
- 用户CRUD（仅管理员）
- Session随机密钥（data/.secret）
- HttpOnly Cookie

### 运行状态
本地 http://localhost:3000 已验证登录API正常

### 部署文档
DEPLOY.md - 包含云服务器/Railway/Render/ngrok四种方案
