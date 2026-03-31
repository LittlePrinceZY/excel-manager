# Excel 数据管理系统 - 部署手册

## 📦 项目结构

```
excel-manager/
├── server.js              # 主入口
├── package.json
├── ecosystem.config.yml   # PM2 配置
├── routes/
│   ├── auth.js            # 认证（登录/登出/改密）
│   ├── users.js           # 用户管理
│   ├── excel.js           # Excel文件管理
│   └── logs.js            # 日志查看
├── utils/
│   ├── db.js              # 用户数据存储
│   ├── logger.js          # 日志工具
│   ├── middleware.js       # 权限中间件
│   └── migrate.js         # 密码自动迁移
├── public/
│   └── index.html         # 前端单页应用
└── data/                  # 运行时数据（自动创建）
    ├── users.json
    ├── files.json
    ├── uploads/
    ├── sessions/
    └── logs/
```

---

## 🖥️ 本地运行

```bash
npm install
node server.js
# 访问 http://localhost:3000
# 默认账号：Admin / 123456
```

---

## 🌐 公网部署方案

### 方案一：云服务器（推荐，完全自主）

适用：阿里云/腾讯云/华为云 等 ECS/CVM

#### 1. 服务器配置要求
- 操作系统：Ubuntu 22.04 LTS（推荐）
- 最低配置：1核2G，20G硬盘
- 开放端口：22（SSH）、80（HTTP）、443（HTTPS）、3000（可选）

#### 2. 安装 Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # 确认 v20.x
```

#### 3. 上传代码
```bash
# 方式A：Git
git init && git add . && git commit -m "init"
# 在服务器上 git clone

# 方式B：SCP 直接传
scp -r ./excel-manager root@你的服务器IP:/var/www/
```

#### 4. 安装依赖并启动
```bash
cd /var/www/excel-manager
npm install --production

# 使用 PM2 守护进程
npm install -g pm2
pm2 start ecosystem.config.yml
pm2 save
pm2 startup  # 开机自启
```

#### 5. 配置 Nginx 反向代理（推荐，支持域名+HTTPS）
```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/excel-manager
```

写入以下内容（替换 `your-domain.com`）：
```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 60M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/excel-manager /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 6. 配置 HTTPS（免费 SSL）
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
# 按提示操作，自动续签
```

---

### 方案二：Railway（免费，5分钟上线）

1. 在 [railway.app](https://railway.app) 注册
2. New Project → Deploy from GitHub
3. 连接仓库，自动检测 Node.js
4. 设置环境变量：`PORT=3000`
5. 部署完成，获得公网域名

---

### 方案三：Render（免费，简单）

1. 在 [render.com](https://render.com) 注册
2. New Web Service → 连接 Git 仓库
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. 自动获得 `xxx.onrender.com` 域名

> ⚠️ **注意**：免费方案的 data/ 目录在重启后会丢失，建议付费方案或挂载持久化存储

---

## 🔒 生产安全清单

- [ ] 登录后立即修改 Admin 默认密码（123456）
- [ ] 配置 HTTPS（避免密码明文传输）
- [ ] 确认服务器防火墙只开放 80/443 端口（不暴露 3000）
- [ ] 定期备份 `data/` 目录

---

## 🛠️ 常用运维命令

```bash
pm2 status          # 查看服务状态
pm2 logs            # 查看日志
pm2 restart excel-manager  # 重启服务
pm2 stop excel-manager     # 停止服务
```

---

## 🏠 本机 Windows 对外暴露（临时测试用）

如果只是临时测试让外部访问，可以用 **内网穿透**：

### 使用 ngrok
```powershell
# 下载 ngrok: https://ngrok.com/download
ngrok http 3000
# 会生成类似 https://abc123.ngrok.io 的公网地址
```

### 使用 Cloudflare Tunnel（免费且稳定）
```powershell
# 下载 cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3000
```

> ⚠️ 内网穿透仅适合临时演示，不适合长期生产使用

