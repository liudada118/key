# 「SDK 获取」模块交接说明

> 用途：整段发给正在跑 key 仓库的开发者或 AI 助手。
> 背景：开发者站点 `shroomSDKWEB`（另一个仓库，`c:/project/ShroomConstruction/shroomSDKWEB`）
> 点「获取 SDK」时会弹一个表单收联系方式，资料 POST 到本系统。
> **这不是审批** —— 对方填完当场就开始下载，本系统只是留一条线索方便后续联系。

---

## 一、这次加了什么（本仓库 6 处改动，均已完成、typecheck 通过）

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 表结构 | `drizzle/schema.ts` | 新表 `sdkRequests` + 三个类型导出 |
| 查询 helper | `server/db.ts` | `ensureSdkRequestsTable` / `createSdkRequest` / `getSdkRequestList` / `getSdkRequestStats` / `getSdkRequestById` / `updateSdkRequest` / `deleteSdkRequest` |
| 公开写入口 | `server/_core/index.ts` | `POST /sdk-requests` + `OPTIONS` 预检（纯 REST + CORS，**故意不走 tRPC**，外站要能匿名提交） |
| 后台读接口 | `server/routers.ts` | `sdkRequests` router：`list` / `stats` / `update` / `delete` |
| 后台页面 | `client/src/pages/SdkRequestManagement.tsx` | 新文件 |
| 路由 + 菜单 | `client/src/App.tsx`、`client/src/components/DashboardLayout.tsx` | `/sdk-requests` |

整体是照着**现有的 `feedback`（用户反馈）模块**一比一做的，那是同构的先例：外部匿名提交 + 联系方式 + 后台跟进字段。

**一个有意的差异**：`feedback` 有 `feedbackScopeCondition()`，靠 `licenseKeyTail` 反查密钥归属做数据域过滤。
SDK 登记是纯匿名线索，没有任何东西可以挂靠，做不出数据域 —— 所以**没做 scope 过滤**，改成在 router 层用 `adminProcedure` 收口。别去补一个假的 scope。

---

## 二、权限规则（明确要求，两处必须保持一致）

**超级管理员（`super_admin`）和管理员（`admin`）可见；子账号（`user`）不可见。**

这条规则落在两个地方，改任何一处都要同步改另一处：

1. **后端**：`server/routers.ts` 里 `sdkRequests` 下**四个过程全部用 `adminProcedure`**
   （`server/_core/trpc.ts:49` 放行 `admin` + `super_admin`，其余抛 FORBIDDEN）
2. **前端菜单**：`client/src/components/DashboardLayout.tsx`
   ```ts
   { icon: Download, label: "SDK 获取", path: "/sdk-requests", roles: ["super_admin", "admin"] }
   ```
   `roles` 必须写死。菜单可见性要是和接口权限对不上，子账号点进去只会看到一个 FORBIDDEN 报错页。

> 注意 `POST /sdk-requests` 这个**公开接口不在此列** —— 它必须允许匿名访问，否则外站提交不了。

---

## 三、「管理员登录后菜单里没有 SDK 获取」怎么办

代码侧已确认是对的。在跑着的 3010 实例上核过：

- `client/src/components/DashboardLayout.tsx` 里有 `sdk-requests`
- `client/src/App.tsx` 里有 `SdkRequestManagement` 路由
- `GET /api/trpc/sdkRequests.stats` 返回 **403**（不是 404）→ 路由已注册、鉴权已生效

所以按下面顺序排查：

1. **先硬刷新浏览器（Ctrl+Shift+R）。** 新增路由和菜单项 Vite HMR 经常带不动，页面还挂着旧 bundle。**九成是这个原因。**
2. 还是没有的话，确认当前登录账号在 `users` 表里的 `role` 字段**字面值**是 `admin` 或 `super_admin`
   （枚举只有 `user` / `admin` / `super_admin` 三档，见 `drizzle/schema.ts:29`）。
   默认的 `admin/admin123` 如果 role 存的是 `user`，菜单就会被过滤掉。
3. 菜单项挂在「监控与安全」分组下，紧跟「反馈管理」，别在「系统管理」里找。

---

## 四、⚠️ 生产库注意

**3010 这个实例通过 SSH 隧道（本地 3308 → 39.105.83.246:20202）直连的是线上生产 MySQL。**

由此产生的两件事：

1. `server/_core/index.ts` 启动时会 `await ensureSdkRequestsTable()`，即 `CREATE TABLE IF NOT EXISTS sdkRequests`。
   服务既然起来了且数据库初始化成功，**这张表应该已经建在生产库里了**。这是纯新增表、不碰任何现有数据，但你应该知道它发生了。先确认一下：
   ```sql
   SHOW TABLES LIKE 'sdkRequests';
   DESC sdkRequests;
   ```
2. 之后在后台点「删除」「改状态」，动的都是**生产数据**。测试完记得清理。

---

## 五、还没验证的部分（重要，别默认它是好的）

**整条数据库读写链路从来没真正跑通过。** 之前的验证是在一台没有 MySQL 的机器上做的
（`ECONNREFUSED 127.0.0.1:3308`），所以：

- ✅ 已验证：`OPTIONS` → 204 且 CORS 头正确；`{}` → 400「缺少姓名」；`{"name":"李四"}` → 400「请至少留一个联系方式」；tRPC 路由已注册且鉴权生效
- ❌ **未验证**：建表是否真的成功、插入、列表、统计、更新、删除

**你现在有真库了，请补上这一步**（会往生产库写一条测试数据，验完删掉）：

```bash
curl -i -X POST http://localhost:3010/sdk-requests \
  -H 'Content-Type: application/json' \
  -d '{"name":"测试张三","phone":"13800138000","organization":"测试大学","source":"sdk-web"}'
# 期望 200 {"ok":true,"id":N}
```

然后登录后台 →「SDK 获取」→ 应看到这条 → 改状态为「已联系」+ 写备注 → 刷新后仍在、`handledByName` 是当前账号 → 删掉。
再用一个 `user` 角色账号登录，确认菜单里**看不到**这个模块。

---

## 六、站点那半边的状态（不在本仓库）

`shroomSDKWEB/app/page.tsx` 已改完，浏览器端 10 项断言全部通过（含「登记接口打不通时弹窗照样关、zip 照样下载」这条底线）。但：

- 站点默认把资料 POST 到 `https://shroom.jq-industries.com/sdk-requests`，**这个接口线上还没部署**。
  本系统部署上线之前，站点上的提交必然失败（不影响下载，这是设计如此）。
- 本地联调可以用环境变量指过来：
  ```
  NEXT_PUBLIC_SDK_REGISTRY_URL=http://localhost:3010/sdk-requests
  ```
- 站点侧代码目前**一行都还没提交**（该机器 git 代理不通）。

---

## 七、字段速查

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | varchar(128) NOT NULL | 姓名，**必填** |
| `phone` | varchar(64) | 手机，站点表单必填；接口层只要求 phone/email 至少有一个 |
| `email` | varchar(128) | 邮箱，选填 |
| `organization` | varchar(255) | 公司 / 学校，选填 |
| `sdkVersion` | varchar(32) | 预留 |
| `source` | varchar(64) NOT NULL | 默认 `sdk-web` |
| `userAgent` / `ipAddress` / `referer` | | 服务端自动采集 |
| `status` | enum | `new` 待联系 / `contacted` 已联系 / `closed` 已关闭 |
| `remark` / `handledById` / `handledByName` / `handledAt` | | 后台跟进用，改状态时自动写 `handledAt` |
| `createdAt` | timestamp | 提交时间 |
