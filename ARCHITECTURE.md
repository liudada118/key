# 架构文档

> 本文档由 Manus 自动生成和维护。最后更新于：2026-03-20 14:17

## 1. 项目概述

**密钥管理系统（Key Manager）** 是一个基于 Shroom1.0 传感器项目衍生的独立 Web 应用，用于管理传感器设备的授权密钥。系统采用**三级权限体系**（超级管理员 → 管理员 → 子账号），支持两种密钥类型（**量产密钥**和**在线租赁密钥**）。核心加密算法使用 **AES-256-GCM** 模式，比原 Shroom1.0 的 AES-ECB 更安全，旧密钥不再兼容。

系统支持**在线密钥**和**离线密钥**两种模式。在线密钥采用"客户自助激活绑定"模式：后台生成密钥时设置最大设备数，客户通过密钥和设备码自助绑定设备，达到上限后不可再绑定新设备。离线密钥使用 RSA-SHA256 签名，支持机器码绑定的离线激活。

## 2. 技术栈

| 分类 | 技术 | 版本/说明 |
| :--- | :--- | :--- |
| **前端框架** | React 19 + Tailwind CSS 4 | SPA 单页应用，浅色主题 |
| **后端框架** | Express 4 + tRPC 11 | 类型安全的 RPC 通信 |
| **数据库** | MySQL / TiDB | 通过 Drizzle ORM 管理 |
| **编程语言** | TypeScript 5.9 | 前后端统一类型 |
| **包管理器** | pnpm 10 | 高效依赖管理 |
| **部署环境** | Manus Platform | 内置 OAuth 认证与托管 |
| **UI 组件库** | shadcn/ui + Radix UI | 无障碍组件体系 |
| **加密算法** | AES-256-GCM (CryptoJS) + RSA-SHA256 | HMAC-SHA256 认证标签，随机 IV |
| **路由** | wouter | 轻量前端路由 |
| **数据序列化** | Superjson | tRPC 数据传输 |
| **测试** | Vitest | 31 个测试用例全部通过 |

## 3. 目录结构

```
key-manager/
├── client/                     # 前端应用
│   ├── src/
│   │   ├── _core/hooks/        # 核心 hooks（useAuth）
│   │   ├── components/         # 可复用 UI 组件
│   │   │   ├── ui/             # shadcn/ui 基础组件
│   │   │   ├── DashboardLayout.tsx  # Dashboard 布局（侧边栏导航 + 权限菜单）
│   │   │   └── ErrorBoundary.tsx
│   │   ├── contexts/           # React 上下文（主题等）
│   │   ├── hooks/              # 自定义 hooks
│   │   ├── lib/                # 工具库（trpc 客户端、utils）
│   │   ├── pages/              # 页面级组件
│   │   │   ├── Home.tsx        # 仪表盘（统计卡片 + 快速操作）
│   │   │   ├── GenerateKey.tsx # 在线密钥生成（单个 + 批量 + 设备数量限制）
│   │   │   ├── KeyList.tsx     # 在线密钥管理列表（筛选 + 分页 + 导出 + 设备管理）
│   │   │   ├── VerifyKey.tsx   # 密钥验证（在线 + 离线 Tab）
│   │   │   ├── OfflineKeyGenerate.tsx # 离线密钥生成
│   │   │   ├── OfflineKeyList.tsx     # 离线密钥管理
│   │   │   ├── AccountManagement.tsx  # 账号管理
│   │   │   ├── CustomerManagement.tsx # 客户管理
│   │   │   ├── SensorManagement.tsx   # 传感器类型管理
│   │   │   ├── MacReader.tsx          # MAC 地址读取
│   │   │   └── NotFound.tsx    # 404 页面
│   │   ├── App.tsx             # 路由配置与布局
│   │   ├── const.ts            # 前端常量
│   │   ├── index.css           # 全局样式与主题变量
│   │   └── main.tsx            # 应用入口
│   └── public/                 # 静态资源（favicon 等）
├── server/                     # 后端逻辑
│   ├── _core/                  # 框架核心（OAuth、上下文、Vite 桥接）
│   │   ├── trpc.ts             # tRPC 初始化 + 三级权限中间件
│   │   └── ...                 # 其他核心模块
│   ├── db.ts                   # 数据库查询 helpers（账号 + 密钥 + 设备 CRUD）
│   ├── routers.ts              # tRPC 路由定义（keys + accounts + auth + sensors + customers + offline）
│   ├── storage.ts              # S3 文件存储
│   ├── crypto.test.ts          # 加密模块测试（24 个用例）
│   ├── auth.logout.test.ts     # 登出测试（1 个用例）
│   └── device-binding.test.ts  # 设备绑定功能测试（6 个用例）
├── drizzle/                    # 数据库 schema 与迁移
│   └── schema.ts               # users + licenseKeys + keyDevices + customers + sensorTypes + offlineKeys + rsaKeyPairs
├── shared/                     # 前后端共享
│   ├── crypto.ts               # AES-256-GCM 加密模块（ESM）
│   ├── crypto-lib.cjs          # AES-256-GCM 加密模块（CJS，Electron 可用）
│   ├── const.ts                # 共享常量
│   └── types.ts                # 共享类型
├── package.json
├── todo.md                     # 功能追踪
└── ARCHITECTURE.md             # 本文档
```

### 关键目录说明

| 目录/文件 | 主要功能 |
| :--- | :--- |
| `client/src/pages/` | 10+ 个页面组件，对应多个路由 |
| `client/src/components/DashboardLayout.tsx` | 侧边栏布局，根据角色动态显示菜单，分在线/离线密钥板块 |
| `server/routers.ts` | tRPC 路由，包含 keys、accounts、auth、sensors、customers、offline 多组 |
| `server/db.ts` | 数据库查询函数，含分级权限过滤、设备绑定管理逻辑 |
| `Dockerfile` | 容器镜像构建入口，安装依赖、执行生产构建并运行 `scripts/start.mjs` |
| `docker-compose.yml` | 容器编排示例，提供 `app + mysql` 的一体化部署方式 |
| `.env.docker.example` | 容器部署环境变量模板，包含端口、数据库和 JWT 配置 |
| `vite.config.ts` | Vite 根配置，指定客户端根目录、别名和构建输出目录 |
| `scripts/` | 启动包装脚本，为开发和生产入口设置 `NODE_ENV`，兼容 Windows PowerShell |
| `drizzle.config.ts` | Drizzle CLI 配置，供容器和主机环境执行数据库迁移 |
| `drizzle/schema.ts` | 7 张表：users、licenseKeys、keyDevices、customers、sensorTypes、offlineKeys、rsaKeyPairs |
| `shared/crypto.ts` | AES-256-GCM 加密核心，ESM 格式 |
| `shared/crypto-lib.cjs` | 同上，CJS 格式，供 Electron 项目 `require()` |

## 4. 核心模块与数据流

### 4.1. 模块关系图 (Mermaid)

```mermaid
graph TD
    subgraph 前端
        A[App.tsx 路由] --> B[DashboardLayout 布局]
        B --> C[Home 仪表盘]
        B --> D[GenerateKey 在线密钥生成]
        B --> E[KeyList 在线密钥管理]
        B --> F[VerifyKey 密钥验证]
        B --> G[AccountManagement 账号管理]
        B --> H1[OfflineKeyGenerate 离线密钥生成]
        B --> H2[OfflineKeyList 离线密钥管理]
        B --> I1[CustomerManagement 客户管理]
        B --> I2[SensorManagement 传感器管理]
    end

    subgraph tRPC 通信层
        C --> J1[keys.stats]
        D --> J2[keys.generate / keys.batchGenerate]
        E --> J3[keys.list / keys.export / keys.devices / keys.unbindDevice]
        F --> J4[keys.verify / keys.activate / keys.verifyOnDevice]
        G --> J5[accounts.*]
        H1 --> J6[offline.generate]
        I1 --> J7[customers.*]
        I2 --> J8[sensors.*]
    end

    subgraph 后端
        J1 --> M[server/routers.ts]
        J2 --> M
        J3 --> M
        J4 --> M
        J5 --> M
        J6 --> M
        J7 --> M
        J8 --> M
        M --> N[server/db.ts]
        M --> O[shared/crypto.ts AES-256-GCM]
        N --> P[(MySQL / TiDB)]
        N --> Q[keyDevices 设备绑定表]
    end

    subgraph 认证与权限
        R[Manus OAuth / 本地登录] --> S[Session Cookie]
        S --> T[protectedProcedure]
        T --> U[adminProcedure]
        T --> V[superAdminProcedure]
        T --> M
    end
```

### 4.2. 主要数据流

**用户认证流程**：用户通过 Manus OAuth 或本地账号密码登录，系统根据 `openId` 或用户名匹配用户记录。首次登录的 Owner 自动设为 `super_admin` 角色，后续用户由上级创建并分配角色。被禁用的账号无法登录。

**在线密钥生成流程**：用户选择传感器类型、有效期天数、密钥类型（量产/租赁）和**设备数量限制**，后端使用 AES-256-GCM 加密生成 hex 格式密钥字符串。密钥元数据（含 maxDevices）同步写入数据库。生成时不绑定设备，密钥可直接发给客户。

**客户端统一接口流程**：客户收到密钥后，通过唯一的 `keys.activate` API 提交密钥和设备码。系统自动处理所有逻辑：未绑定→自动绑定，已绑定→直接返回授权信息，设备满→拒绝。无论成功还是失败，都会返回完整的授权信息（传感器类型、到期时间、剩余天数等）。客户端每次启动时只需调用这一个接口即可。

**设备解绑流程**：管理员可通过 `keys.unbindDevice` API 解绑设备。如果所有设备都被解绑，密钥状态重置为"未激活"。

**离线密钥流程**：通过机器码 + RSA-SHA256 签名生成离线激活码，客户端使用公钥验证签名。

**分级查看流程**：超级管理员可查看所有密钥；管理员可查看自己及其下属子账号的密钥；子账号仅可查看自己创建的密钥。

## 5. API 端点 (Endpoints)

| 方法 | 路径 | 权限 | 描述 |
| :--- | :--- | :--- | :--- |
| `tRPC` | `auth.me` | 公开 | 获取当前登录用户信息 |
| `tRPC` | `auth.logout` | 公开 | 用户登出 |
| `tRPC` | `auth.login` | 公开 | 本地账号密码登录 |
| `tRPC` | `keys.generate` | 登录 | 生成单个密钥（含 maxDevices） |
| `tRPC` | `keys.batchGenerate` | 登录 | 批量生成密钥（含 maxDevices） |
| `tRPC` | `keys.list` | 登录 | 分页查询密钥列表（分级过滤） |
| `tRPC` | `keys.verify` | 登录 | 验证/解密密钥（含设备绑定信息） |
| `tRPC` | `keys.activate` | **公开** | 客户端统一接口：激活绑定 + 验证 + 返回授权信息 |
| `tRPC` | `keys.devices` | 登录 | 获取密钥已绑定设备列表 |
| `tRPC` | `keys.unbindDevice` | 管理员+ | 解绑设备 |
| `tRPC` | `keys.changeCategory` | 超级管理员 | 更改密钥类型 |
| `tRPC` | `keys.stats` | 登录 | 获取密钥统计数据 |
| `tRPC` | `keys.export` | 登录 | 导出密钥（CSV/JSON） |
| `tRPC` | `accounts.*` | 管理员+ | 账号管理 CRUD |
| `tRPC` | `customers.*` | 登录 | 客户管理 CRUD |
| `tRPC` | `sensors.*` | 超级管理员 | 传感器类型管理 |
| `tRPC` | `offline.*` | 登录 | 离线密钥生成与管理 |
| `tRPC` | `system.notifyOwner` | 登录 | 向 Owner 发送通知 |

## 6. 数据库表结构

| 表名 | 主要字段 | 说明 |
| :--- | :--- | :--- |
| `users` | id, openId, username, password, role, parentId, isActive | 三级角色用户表 |
| `license_keys` | id, keyString, sensorType, days, category, maxDevices, isActivated, customerId | 在线密钥表（含设备数量限制） |
| `key_devices` | id, keyId, deviceCode, deviceName, boundAt, boundIp | 设备绑定记录表 |
| `customers` | id, name, contactPerson, phone, isActive | 客户表 |
| `sensor_types` | id, value, label, groupName, groupIcon, sortOrder | 传感器类型表 |
| `offline_keys` | id, machineId, activationCode, sensorType, days | 离线密钥表 |
| `rsa_key_pairs` | id, publicKey, privateKey, isActive | RSA 密钥对表 |

## 7. 加密模块

### 7.1. 算法说明

系统使用 **AES-256-GCM** 加密模式（通过 CryptoJS CTR 模式 + HMAC-SHA256 认证标签模拟），相比原 Shroom1.0 的 AES-ECB 具有以下优势：

| 特性 | AES-ECB（旧） | AES-256-GCM（新） |
| :--- | :--- | :--- |
| IV 随机性 | 无 IV | 每次 12 字节随机 IV |
| 认证标签 | 无 | HMAC-SHA256 前 16 字节 |
| 相同明文 | 相同密文 | 不同密文 |
| 篡改检测 | 不支持 | 支持 |

### 7.2. 密钥格式

密钥字符串为 hex 编码，结构为：`IV(24字符) + AuthTag(32字符) + Ciphertext(hex)`。

加密载荷 JSON 格式：`{"date": <到期时间戳>, "file": "<传感器类型>", "cat": "<production|rental>", "v": 2}`。

### 7.3. Electron 集成

将 `shared/crypto-lib.cjs` 复制到 Electron 项目中，通过 `require('./crypto-lib.cjs')` 引入即可使用 `decodeLicenseKey()` 函数验证密钥。依赖 `crypto-js` npm 包。

## 8. 环境变量

| 变量名 | 描述 |
| :--- | :--- |
| `DATABASE_URL` | 数据库连接字符串 |
| `JWT_SECRET` | Session Cookie 签名密钥 |
| `VITE_APP_ID` | Manus OAuth 应用 ID |
| `OAUTH_SERVER_URL` | Manus OAuth 后端地址 |
| `VITE_OAUTH_PORTAL_URL` | Manus 登录门户地址 |
| `OWNER_OPEN_ID` | 项目 Owner 的 OpenID |
| `OWNER_NAME` | 项目 Owner 名称 |
| `BUILT_IN_FORGE_API_URL` | Manus 内置 API 地址 |
| `BUILT_IN_FORGE_API_KEY` | Manus 内置 API 密钥 |

## 9. 项目进度

| 完成时间 | 分支 | 完成的功能/工作 | 说明 |
| :--- | :--- | :--- | :--- |
| 2026-03-06 10:31 | main | 项目初始化 | React 19 + tRPC + Drizzle ORM 基础架构 |
| 2026-03-06 10:31 | main | 用户认证模块 | Manus OAuth 登录/登出 |
| 2026-03-06 10:31 | main | 原始密钥系统分析 | 分析 Shroom1.0 的 AES-ECB 加密逻辑 |
| 2026-03-06 21:50 | main | 数据库 schema | users 表（三级角色 + 层级关系）+ licenseKeys 表（量产/租赁 + 激活状态） |
| 2026-03-06 21:50 | main | AES-256-GCM 加密模块 | 独立可导出，ESM + CJS 双格式，Electron 可直接 require |
| 2026-03-06 21:50 | main | 三级权限中间件 | super_admin / admin / user 权限检查 |
| 2026-03-06 21:50 | main | 完整后端 API | 密钥生成/批量/验证/激活/统计/导出 + 账号管理 CRUD |
| 2026-03-06 21:50 | main | 前端全部页面 | 仪表盘、密钥生成、密钥管理、密钥验证、账号管理 5 个页面 |
| 2026-03-06 21:50 | main | 暗色主题 | 专业暗色配色方案，OKLCH 色彩空间 |
| 2026-03-06 21:50 | main | Vitest 测试 | 16 个测试用例全部通过（加密/解密/生成/解码/篡改检测） |
| 2026-03-19 19:25 | main | 在线密钥设备绑定重构 | 新增 keyDevices 表、maxDevices 字段，客户自助激活绑定模式 |
| 2026-03-19 19:25 | main | 设备管理 API | activate（公开）、devices、unbindDevice 三个新端点 |
| 2026-03-19 19:25 | main | 前端设备管理 | 生成页面添加设备数量限制，列表页面显示设备绑定信息和解绑功能 |
| 2026-03-19 19:25 | main | 设备绑定测试 | 新增 6 个测试用例，总计 31 个测试全部通过 |
| 2026-03-20 14:10 | main | 启动与构建配置修复 | 恢复 Windows 兼容启动入口并补回 `vite.config.ts`，修复 `npm run start` 所需的生产构建链路 |
| 2026-03-20 14:17 | main | 容器部署配置 | 新增 Dockerfile、docker-compose、容器环境变量模板和 Drizzle 配置，支持宝塔容器部署 |

## 10. 更新日志

| 时间 | 分支 | 变更类型 | 描述 |
| :--- | :--- | :--- | :--- |
| 2026-03-06 10:31 | main | 初始化 | 创建项目架构文档 |
| 2026-03-06 21:50 | main | 新增功能 | 完成全部核心功能：三级权限、密钥生成/验证/管理、账号管理、AES-256-GCM 加密、暗色主题 |
| 2026-03-19 19:25 | main | 优化重构 | 在线密钥从“后台绑定设备”改为“客户自助激活绑定”模式：新增 keyDevices 设备绑定表、maxDevices 设备数量限制、公开激活 API、管理员解绑功能 |
| 2026-03-20 11:55 | main | 优化重构 | 合并客户端 3 个接口为 1 个统一 activate 接口（自动绑定+验证+返回授权信息）；移除 verifyOnDevice 接口 |
| 2026-03-20 11:55 | main | 新增功能 | API 文档页面添加一键复制功能（HTTP 调用示例 + Python 代码示例） |
| 2026-03-20 14:10 | main | 配置变更 | 将 `start`/`dev` 脚本改为通过 `scripts/*.mjs` 设置 `NODE_ENV`，并补回 `vite.config.ts` 以恢复生产构建 |
| 2026-03-20 14:17 | main | 配置变更 | 新增容器化部署文件（Dockerfile、docker-compose、.env.docker.example、drizzle.config.ts），支持宝塔容器构建与运行 |

*变更类型：`新增功能` / `优化重构` / `修复缺陷` / `配置变更` / `文档更新` / `依赖升级` / `初始化`*

---

*此文档旨在提供项目架构的快照，具体实现细节请参考源代码。*
