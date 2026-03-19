# 密钥管理系统 — 独立部署指南

**版本：** v1.5
**更新日期：** 2026-03-19

---

## 1. 项目概述

密钥管理系统（Key Manager）是一个基于 Shroom1.0 传感器项目的独立 Web 应用，用于管理传感器设备的授权密钥。系统采用三级权限体系（超级管理员 → 管理员 → 子账号），支持量产密钥和在线租赁密钥两种类型，使用 AES-256-GCM 加密算法，集成 Web Serial API 实现设备 MAC 地址自动读取。

本文档提供完整的独立部署方案，系统不依赖任何第三方平台，可在任何支持 Node.js 和 MySQL 的服务器上运行。

---

## 2. 系统要求

| 项目 | 最低要求 | 推荐 | 说明 |
|:---|:---|:---|:---|
| **Node.js** | v18.0+ | v22 LTS | 运行时环境 |
| **pnpm** | v9.0+ | v10.x | 包管理器 |
| **MySQL** | 5.7+ | 8.0+ | 也支持 TiDB / MariaDB 10.5+ |
| **操作系统** | Linux / macOS / Windows | Ubuntu 22.04 LTS | 生产环境推荐 Linux |
| **内存** | 512MB+ | 1GB+ | 含数据库 |
| **磁盘** | 200MB+ | 1GB+ | 含依赖和数据库 |

可选组件：

| 组件 | 用途 |
|:---|:---|
| **Nginx** | 反向代理，提供 HTTPS、静态文件缓存 |
| **Docker** | 容器化部署，简化环境配置 |
| **PM2** | 进程管理，提供自动重启、日志管理 |

---

## 3. 快速开始

### 3.1 获取源码

```bash
git clone https://github.com/liudada118/key.git
cd key
```

### 3.2 安装依赖

```bash
# 安装 pnpm（如果尚未安装）
npm install -g pnpm

# 安装项目依赖
pnpm install
```

### 3.3 配置环境变量

在项目根目录创建 `.env` 文件：

```env
# ===== 必填 =====

# MySQL 数据库连接字符串
DATABASE_URL=mysql://root:password@localhost:3306/key_manager

# JWT 签名密钥（任意随机字符串，建议 32 位以上）
JWT_SECRET=your-random-secret-key-at-least-32-chars

# ===== 可选 =====

# 服务端口（默认 3000）
PORT=3000
```

**DATABASE_URL 格式示例：**

```env
# 本地 MySQL
DATABASE_URL=mysql://root:password@localhost:3306/key_manager

# 远程 MySQL（如阿里云 RDS）
DATABASE_URL=mysql://admin:password@rm-xxx.mysql.rds.aliyuncs.com:3306/key_manager?ssl={"rejectUnauthorized":true}

# TiDB Serverless
DATABASE_URL=mysql://user:password@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/key_manager?ssl={"rejectUnauthorized":true}
```

> **安全提示：** `JWT_SECRET` 必须使用强随机字符串。可以使用以下命令生成：
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

### 3.4 初始化数据库

```bash
# 创建数据库（如果还没创建）
mysql -u root -p -e "CREATE DATABASE key_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 推送表结构
pnpm db:push
```

该命令会自动创建以下三张表：

| 表名 | 用途 | 主要字段 |
|:---|:---|:---|
| `users` | 用户表（三级权限） | id, username, password, role, createdById, isActive |
| `licenseKeys` | 密钥表 | id, keyString, sensorType, category, days, isActivated, customerId |
| `customers` | 客户表 | id, name, contactPerson, phone, email, isActive |

> 如果 `pnpm db:push` 出现交互式提示（如 "create column" 或 "rename column"），选择 **create column**。

### 3.5 启动

**开发模式：**

```bash
pnpm dev
```

**生产模式：**

```bash
pnpm build
pnpm start
```

访问 `http://localhost:3000`，使用默认管理员账号登录：

| 用户名 | 密码 | 角色 |
|:---|:---|:---|
| `admin` | `admin123` | 超级管理员 |

> **首次启动时系统会自动创建默认超级管理员账号。** 请登录后立即修改密码。

---

## 4. 生产环境部署

### 4.1 使用 PM2 部署（推荐）

PM2 是 Node.js 的生产级进程管理器，提供自动重启、日志管理和集群模式。

```bash
# 安装 PM2
npm install -g pm2

# 构建项目
pnpm build

# 使用 PM2 启动
pm2 start dist/index.js --name key-manager \
  --max-memory-restart 512M \
  --log-date-format "YYYY-MM-DD HH:mm:ss"

# 设置开机自启
pm2 startup
pm2 save
```

常用 PM2 命令：

| 命令 | 说明 |
|:---|:---|
| `pm2 status` | 查看进程状态 |
| `pm2 logs key-manager` | 查看日志 |
| `pm2 restart key-manager` | 重启服务 |
| `pm2 stop key-manager` | 停止服务 |
| `pm2 monit` | 实时监控 |

也可以创建 `ecosystem.config.cjs` 配置文件：

```javascript
module.exports = {
  apps: [{
    name: 'key-manager',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
```

```bash
pm2 start ecosystem.config.cjs --env production
```

### 4.2 Nginx 反向代理 + HTTPS

生产环境强烈建议使用 Nginx 作为反向代理，提供 HTTPS 支持。Web Serial API 要求 HTTPS 或 localhost 才能使用。

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书（推荐使用 certbot 自动签发 Let's Encrypt 证书）
    ssl_certificate     /etc/nginx/ssl/your-domain.com.pem;
    ssl_certificate_key /etc/nginx/ssl/your-domain.com.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 安全头
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 反向代理到 Node.js 服务
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 静态文件缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

使用 certbot 自动签发 Let's Encrypt 免费 SSL 证书：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 4.3 Docker 部署

创建 `Dockerfile`：

```dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# 安装依赖
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile

# 复制源码并构建
COPY . .
RUN pnpm build

# ---- 生产镜像 ----
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

# 只安装生产依赖
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod

# 复制构建产物和迁移文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=mysql://keymanager:your_db_password@db:3306/key_manager
      - JWT_SECRET=your-random-jwt-secret-at-least-32-chars
      - PORT=3000
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=root_password
      - MYSQL_DATABASE=key_manager
      - MYSQL_USER=keymanager
      - MYSQL_PASSWORD=your_db_password
    volumes:
      - mysql_data:/var/lib/mysql
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  mysql_data:
```

启动：

```bash
# 构建并启动
docker compose up -d --build

# 运行数据库迁移（首次部署时）
docker compose exec app npx drizzle-kit generate
docker compose exec app npx drizzle-kit migrate

# 查看日志
docker compose logs -f app

# 停止服务
docker compose down
```

---

## 5. 三级权限体系

| 角色 | 权限 | 可创建的下级 |
|:---|:---|:---|
| **超级管理员** (super_admin) | 查看所有数据、管理所有账号 | 管理员、子账号 |
| **管理员** (admin) | 查看自己和下属数据、管理下属账号 | 子账号 |
| **子账号** (user) | 仅查看自己的数据 | 无 |

所有角色都可以生成密钥、验证密钥、管理客户（在各自权限范围内）。

---

## 6. 数据库管理

### 6.1 数据库迁移

修改 `drizzle/schema.ts` 后，运行迁移命令同步数据库结构：

```bash
pnpm db:push
```

### 6.2 数据库备份

```bash
# 备份
mysqldump -u root -p key_manager > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复
mysql -u root -p key_manager < backup_20260319_120000.sql
```

### 6.3 重置管理员密码

```bash
# 生成 bcrypt 哈希
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('新密码', 10).then(h => console.log(h));"

# 更新数据库
mysql -u root -p -e "UPDATE users SET password = '上面生成的哈希' WHERE username = 'admin';" key_manager
```

或者删除所有用户后重启服务（系统会自动创建默认管理员 admin/admin123）：

```bash
mysql -u root -p -e "DELETE FROM users;" key_manager
# 重启服务
```

---

## 7. 加密库集成（Electron 项目）

将 `shared/crypto-lib.cjs` 复制到 Electron 项目中即可使用：

```bash
# 复制加密库
cp shared/crypto-lib.cjs /path/to/your-electron-project/lib/

# 确保安装 crypto-js 依赖
cd /path/to/your-electron-project
npm install crypto-js
```

```javascript
// Electron 项目中使用
const { generateLicenseKey, decodeLicenseKey } = require('./lib/crypto-lib.cjs');

// 验证密钥
const result = decodeLicenseKey(keyString);
if (result.valid) {
  console.log('传感器类型:', result.sensorTypes);
  console.log('到期时间:', new Date(result.expireTimestamp));
  console.log('剩余天数:', result.remainingDays);
  console.log('密钥类型:', result.category); // 'production' 或 'rental'
} else {
  console.log('密钥无效:', result.error);
}

// 生成密钥
const key = generateLicenseKey(['hand0205', 'robot1'], 365, 'production');
```

密钥字符串为 hex 编码，结构为 `IV(24字符) + AuthTag(32字符) + Ciphertext(hex)`。加密载荷 JSON 格式：

```json
{
  "date": 1742400000000,
  "file": "hand0205",
  "cat": "production",
  "v": 2
}
```

其中 `file` 字段可以是单个传感器类型字符串、传感器类型数组或 `"all"`（全部类型）。

---

## 8. 常见问题

### Q: 使用 admin/admin123 登录提示"用户名或密码错误"

数据库中的密码哈希可能不正确。重新生成并更新：

```bash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('admin123', 10).then(h => console.log(h));"
# 将输出的哈希更新到数据库
```

### Q: 数据库连接失败

1. 确认 `.env` 文件中 `DATABASE_URL` 格式正确
2. 确认 MySQL 服务正在运行：`systemctl status mysql`
3. 确认数据库用户有足够权限
4. 远程数据库需确认网络连通性和防火墙规则

### Q: MAC 地址读取功能不工作

Web Serial API 要求：
- 使用 Chrome 89+ 或 Edge 89+ 浏览器
- 通过 HTTPS 或 localhost 访问
- 用户手动授权串口设备

### Q: 端口被占用

```bash
# 查看占用端口的进程
lsof -i :3000

# 修改 .env 中的 PORT 变量，或终止占用进程
```

系统内置端口自动探测，如果指定端口被占用会自动尝试下一个可用端口。

### Q: 如何更新到新版本

```bash
git pull origin main
pnpm install
pnpm db:push
pnpm build
pm2 restart key-manager  # 或 docker compose up -d --build
```

---

## 9. 安全建议

**密码安全：** 首次登录后立即修改默认管理员密码。所有密码使用 bcrypt 算法（cost factor 10）哈希存储。

**JWT 密钥：** `JWT_SECRET` 必须使用强随机字符串（至少 32 字符），JWT Token 存储在 HttpOnly Cookie 中。

**HTTPS：** 生产环境必须使用 HTTPS。Web Serial API 和 Cookie 安全属性都依赖 HTTPS。

**数据库：** 使用独立数据库用户，仅授予必要权限。定期备份数据库。

**防火墙：** 仅开放 80/443 端口，不要将 Node.js 端口直接暴露到公网。

---

## 10. 项目脚本参考

| 命令 | 说明 |
|:---|:---|
| `pnpm dev` | 启动开发服务器（热重载） |
| `pnpm build` | 构建生产版本（前端 + 后端） |
| `pnpm start` | 启动生产服务器 |
| `pnpm check` | TypeScript 类型检查 |
| `pnpm test` | 运行 Vitest 测试（25 个测试用例） |
| `pnpm db:push` | 生成并执行数据库迁移 |
| `pnpm format` | 代码格式化（Prettier） |

---

## 11. 目录结构

```
key-manager/
├── client/                     # 前端 React 应用
│   ├── src/
│   │   ├── pages/              # 页面组件（7 个页面）
│   │   │   ├── Home.tsx        # 仪表盘
│   │   │   ├── GenerateKey.tsx # 密钥生成（单个 + 批量）
│   │   │   ├── KeyList.tsx     # 密钥管理列表
│   │   │   ├── VerifyKey.tsx   # 密钥验证
│   │   │   ├── AccountManagement.tsx # 账号管理
│   │   │   ├── CustomerManagement.tsx # 客户管理
│   │   │   └── MacReader.tsx   # MAC 地址读取
│   │   ├── components/         # 通用组件
│   │   ├── hooks/              # 自定义 hooks
│   │   └── lib/                # 工具库（含串口服务）
│   └── index.html
├── server/                     # 后端 Express + tRPC
│   ├── _core/                  # 框架核心（认证、路由、Vite）
│   ├── routers.ts              # API 路由定义
│   ├── db.ts                   # 数据库查询
│   └── crypto.test.ts          # 测试文件（24 个用例）
├── drizzle/                    # 数据库 schema 和迁移
│   └── schema.ts               # 表结构定义（users + licenseKeys + customers）
├── shared/                     # 前后端共享代码
│   ├── crypto.ts               # AES-256-GCM 加密模块（ESM）
│   ├── crypto-lib.cjs          # 独立加密库（CJS，供 Electron 使用）
│   └── sensor-types.ts         # 54+ 种传感器类型定义（7 大分组）
├── .env                        # 环境变量（需自行创建）
├── package.json
├── ARCHITECTURE.md             # 技术架构文档
└── DEPLOY.md                   # 本文档
```

---

*本文档提供密钥管理系统的完整独立部署方案。如有问题，请参考 ARCHITECTURE.md 了解系统架构详情。*
