# Key Manager 架构图

## 总览
- 系统定位
	- 授权密钥管理
	- 传感器类型管理
	- 客户合同管理
	- 设备心跳监控
	- 离线授权生成
- 技术栈
	- React 19
	- Vite 7
	- Express 4
	- tRPC 11
	- Drizzle ORM
	- MySQL
	- Tailwind CSS 4
	- Radix UI
- 运行入口
	- `server/_core/index.ts`
	- `client/src/main.tsx`
	- `client/src/App.tsx`
	- `drizzle/schema.ts`
	- `shared/crypto.ts`

## 系统架构图
```mermaid
flowchart TD
	user["用户浏览器"] --> ui["React 单页应用"]
	ui --> layout["DashboardLayout"]
	layout --> pages["业务页面"]
	pages --> trpcClient["tRPC Client"]
	trpcClient --> api["/api/trpc"]

	api --> router["server/routers.ts"]
	router --> auth["权限中间件"]
	router --> dbHelpers["server/db.ts"]
	router --> crypto["shared/crypto.ts"]
	router --> storage["server/storage.ts"]

	auth --> session["Session Cookie"]
	dbHelpers --> orm["Drizzle ORM"]
	orm --> mysql[("MySQL")]

	serverRest["REST 接口"] --> dbHelpers
	device["外部设备客户端"] --> serverTime["/serverTime"]
	device --> licenseCheck["/licenseCheck"]
	device --> sensorTypes["/sensorTypes"]
	device --> feedback["/feedback"]

	serverTime --> serverRest
	licenseCheck --> serverRest
	sensorTypes --> serverRest
	feedback --> serverRest

	oauth["OAuth / 本地登录"] --> session
	appServer["Express Server"] --> api
	appServer --> serverRest
	appServer --> vite["Vite dev middleware"]
	appServer --> static["生产静态资源"]
```

## 前端
- 入口层
	- `main.tsx`
	- `App.tsx`
	- 全局样式
	- 主题上下文
- 布局层
	- `DashboardLayout`
	- 侧边导航
	- 角色菜单
	- 错误边界
	- 骨架屏
- 通信层
	- `lib/trpc.ts`
	- React Query
	- Superjson
	- Cookie 会话
- 页面层
	- 首页仪表盘
	- 在线密钥生成
	- 在线密钥列表
	- 密钥验证
	- 离线密钥生成
	- 离线密钥列表
	- 账号管理
	- 客户管理
	- 合同管理
	- 传感器类型
	- 设备报码
	- 心跳监控
	- 审计日志
	- 反馈管理
- 浏览器能力
	- Web Serial
	- MAC 读取
	- 剪贴板
	- 地图组件

## 后端
- 服务入口
	- Express 初始化
	- JSON body
	- URL encoded body
	- HTTP Server
	- 自动端口探测
- REST 接口
	- `/serverTime`
	- `/licenseCheck`
	- `/sensorTypes`
	- `/feedback`
- tRPC 接口
	- `/api/trpc`
	- `appRouter`
	- `createContext`
	- `createExpressMiddleware`
- 核心路由
	- `auth`
	- `accounts`
	- `customers`
	- `sensors`
	- `offlineKeys`
	- `keys`
	- `audit`
	- `heartbeat`
	- `contracts`
	- `deviceCodes`
	- `feedback`
- 权限模型
	- `publicProcedure`
	- `protectedProcedure`
	- `adminProcedure`
	- `superAdminProcedure`
- 启动初始化
	- 默认超级管理员
	- 默认传感器类型
	- RSA 密钥对
	- 设备报码表

## 数据架构图
```mermaid
erDiagram
	users ||--o{ licenseKeys : creates
	users ||--o{ customers : owns
	users ||--o{ contracts : creates
	users ||--o{ offlineKeys : creates
	users ||--o{ auditLogs : writes
	users ||--o{ deviceCodeRecords : records
	customers ||--o{ contracts : has
	customers ||--o{ licenseKeys : binds
	contracts ||--o{ licenseKeys : authorizes
	licenseKeys ||--o{ keyStatusHistory : changes
	licenseKeys ||--o{ deviceHeartbeats : receives
	sensorTypes ||--o{ licenseKeys : classifies
	rsaKeyPairs ||--o{ offlineKeys : signs

	users {
		int id
		string username
		string role
		boolean isActive
	}
	customers {
		int id
		string name
		boolean isActive
	}
	contracts {
		int id
		string contractNo
		string status
	}
	licenseKeys {
		int id
		string keyString
		string status
		boolean isActivated
	}
	sensorTypes {
		int id
		string value
		string label
	}
	offlineKeys {
		int id
		string machineId
		string activationCode
	}
```

## 数据层
- 数据库
	- MySQL
	- Drizzle ORM
	- SQL 迁移
	- `DATABASE_URL`
- 表结构
	- `users`
	- `customers`
	- `contracts`
	- `licenseKeys`
	- `deviceHeartbeats`
	- `sensorTypes`
	- `rsaKeyPairs`
	- `offlineKeys`
	- `keyStatusHistory`
	- `auditLogs`
	- `deviceCodeRecords`
	- `feedback`
- 访问封装
	- `getDb`
	- 用户查询
	- 密钥 CRUD
	- 客户 CRUD
	- 合同 CRUD
	- 审计记录
	- 心跳记录

## 授权流程图
```mermaid
sequenceDiagram
	participant Admin as 后台用户
	participant UI as React 页面
	participant API as tRPC keys
	participant Crypto as 加密模块
	participant DB as MySQL
	participant Device as 设备客户端

	Admin->>UI: 填写授权信息
	UI->>API: keys.generate
	API->>Crypto: generateLicenseKey
	Crypto-->>API: keyString
	API->>DB: 写入 licenseKeys
	API-->>UI: 返回密钥
	Device->>API: keys.activate 或 licenseCheck
	API->>Crypto: decodeLicenseKey
	API->>DB: 查询状态并激活
	API-->>Device: 授权结果
```

## 安全边界
- 会话安全
	- JWT Secret
	- Cookie
	- 当前用户上下文
- 权限边界
	- 公开接口
	- 登录接口
	- 管理员接口
	- 超级管理员接口
- 密钥安全
	- AES-256-GCM 风格载荷
	- HMAC 校验
	- RSA-SHA256 离线签名
	- 过期检测
	- 暂停撤销
	- 篡改标记
- 数据边界
	- 分级查看
	- 创建者归属
	- 客户归属
	- 合同绑定
	- 审计追踪

## 部署结构
- 开发模式
	- `pnpm dev`
	- tsx watch
	- Vite middleware
	- Express 同端口
- 生产模式
	- `pnpm build`
	- Vite build
	- esbuild server
	- `pnpm start`
	- 静态资源托管
- 环境变量
	- `DATABASE_URL`
	- `JWT_SECRET`
	- `BUILT_IN_FORGE_API_URL`
	- `BUILT_IN_FORGE_API_KEY`
	- OAuth 配置

## 模块依赖图
```mermaid
flowchart LR
	client["client/src"] --> shared["shared"]
	client --> trpcClient["client/src/lib/trpc.ts"]
	trpcClient --> serverRouter["server/routers.ts"]

	serverCore["server/_core"] --> serverRouter
	serverRouter --> db["server/db.ts"]
	serverRouter --> shared
	serverRouter --> storage["server/storage.ts"]
	db --> schema["drizzle/schema.ts"]
	schema --> migrations["drizzle/*.sql"]
	db --> mysql[("MySQL")]

	shared --> cryptoTs["shared/crypto.ts"]
	shared --> types["shared/types.ts"]
	shared --> consts["shared/const.ts"]
```

## 关键文件
- 前端入口
	- `client/src/main.tsx`
	- `client/src/App.tsx`
- 前端布局
	- `client/src/components/DashboardLayout.tsx`
	- `client/src/components/ErrorBoundary.tsx`
- 前端页面
	- `client/src/pages/Home.tsx`
	- `client/src/pages/GenerateKey.tsx`
	- `client/src/pages/KeyList.tsx`
	- `client/src/pages/VerifyKey.tsx`
	- `client/src/pages/OfflineKeyGen.tsx`
	- `client/src/pages/OfflineKeyList.tsx`
- 后端入口
	- `server/_core/index.ts`
	- `server/_core/vite.ts`
	- `server/_core/context.ts`
	- `server/_core/trpc.ts`
- 后端业务
	- `server/routers.ts`
	- `server/db.ts`
	- `server/storage.ts`
- 共享模块
	- `shared/crypto.ts`
	- `shared/crypto-lib.cjs`
	- `shared/types.ts`
	- `shared/const.ts`
- 数据库
	- `drizzle/schema.ts`
	- `drizzle/relations.ts`
	- `drizzle/*.sql`
