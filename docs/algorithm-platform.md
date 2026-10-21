# 算法平台首期：人工报价与交付

日期：2026-10-21。依据 Shroom 算法交易平台 PRD v0.2，首期采用人工报价、核对收款、登记交付。现有软件密钥仅证明客户归属，不包含算法财务查询权限，也不自动变成商业算法运行许可。

## 上线准备与边界

1. 发布代码前备份数据库并评审 `drizzle/0024_algorithm_platform.sql`。本次开发**没有执行迁移或部署**，旧的 0～23 号迁移记录保留。
2. 由运维单独运行既有迁移流程，新增五张独立表：商品身份、不可变版本、客户需求、人工订单、追加审计事件。不改已有密钥、客户、聊天或传感器数据。
3. 配置 `ALGORITHM_PLATFORM_FINANCE_USER_IDS=12,18`，值为现有超级管理员用户 ID。默认空列表，所有财务动作关闭；账号还须当前有效、角色为 `super_admin`。员工令牌无论对应哪个角色均不能操作财务或审核。
4. 管理网站侧栏“算法平台”进入 `/algorithm-platform`。员工可提交和查看本人商品，超级管理员可审核、跟进需求，取得显式财务职责的超管可报价、确认收款和登记交付。
5. 至少有另一位独立超级管理员审核版本。程序阻止同一提交人自审；审核人员仍需核对业务利益关系，不应借换账号规避回避要求。

已实现的是元数据目录与人工交易记录。未实现第三方代码上传、沙箱执行、自动下载/安装、在线支付、退款、卖家结算、云端调用扣费和自动试用许可。`deviceLimit` 是订单约定数量，尚非客户端运行时强制设备额度；交付记录须注明实际执行包、版本、交付渠道和安装核验情况。不得把“已登记交付”当成“已安装/已启用/效果达标”。

试用申请只进入人工跟进，不开始计时、不扣次数、不产生有效输出。未来接入真实试用引擎时，应以首次有效输出证据起算，并保留启动失败；不能用本期申请时间代替起算时间。现有免费本机算法使用流程不变。

## 商品与状态

商品 ID 首次提交时绑定现有员工 ID，后续不同版本只能由同一提交人追加；相同 ID/版本与相同内容的重试返回原记录。不同内容不能覆盖已提交版本（含退回版本），应增加版本号。独立审核通过后进入目录；目录按版本提交记录顺序选取每个商品最近的已发布版本，未发布内容不公开。旧订单始终引用原版本 ID。

商品身份行与版本、请求、订单的状态修改均在 MySQL 事务内加锁。商品归属使用独立主键行锁，避免同时创建不同版本绕过归属；请求唯一键为 `(customer_id,idempotency_key)`，每份需求最多一张订单。冲突/死锁返回 409，客户端使用原请求编号重试，不改变已有内容。审计事件和状态在同一事务内写入，不删除或覆盖历史事件。

状态转换：

```text
版本：pending → published / rejected
需求：requested → reviewing / cancelled；requested / reviewing → quoted
订单：quoted → payment_confirmed → delivered
      quoted → cancelled
```

已收款订单不能直接取消或删除；退款需要单独设计核对和账务流程。金额以最小货币单位的安全整数保存，如 CNY 的 29 代表 0.29 元。收款必须填写人工核验凭据引用；交付另填独立交付凭据引用。不接受凭据文件或原始银行流水上传。

## HTTP 接口

统一前缀 `/api/algorithm-platform`，响应为 JSON，禁止缓存。请求 JSON 限 48 KiB，未知字段拒绝，错误结构 `{error,message}`。无表时返回 503 `PLATFORM_MIGRATION_REQUIRED`；状态/唯一键冲突为 409；越权为 403。

### 公开目录

- `GET /catalog` → `{schemaVersion:1,products:Product[]}`。
- `GET /products/:id` → `{product:Product}`；不存在或没有已发布版本时 404。

`Product` 仅为能力声明，不含执行代码/模型/密钥、原始样本、付款凭据、内部人员 ID 或审计数据。文本字段由提交人填写并由人工审查，发布前仍需检查文本内是否误填敏感内容。

```ts
type Product = {
  id: string; name: string; summary: string; task: string;
  deliveryType: 'local' | 'cloud' | 'custom';
  seller: {name: string; kind: 'self' | 'invited'};
  version: string; versionId: number; packageId: string | null;
  compatibility: {matrixTotals: number[]; sensorTypes: string[]};
  inputs: string; outputs: string; evidence: string;
  limitations: string; support: string;
  pricing: {mode: 'manual_quote'}; status: 'published';
};
```

长度限制：ID/packageId/sensorType 最多 80（字母数字开头，其后字母数字 `._-`）；name160、summary500、task1000、seller.name120；version 为三段数字语义版本（可带预发布后缀），最多48；inputs/outputs/evidence/limitations 各4000、support2000。matrixTotals 为 1～65536 整数，矩阵列表和 sensorTypes 各最多64项。文本必填且去除首尾空白。

### 员工提交

支持既有管理网站登录 Cookie，或 `Authorization: Bearer sps_...` 员工提交令牌。沿用令牌哈希、到期、撤销和账号有效性校验，不新增员工角色。

- `POST /submissions {product}` → `{submission:{id,status,product}}`。product 为上述公开字段，省略 `versionId/status`，不允许源码等额外字段。
- `GET /submissions` → `{items:[{id,status,submittedById,reviewNote,product}]}`。令牌只能读取本人提交；登录超管可读取全体。

`packageId` 只是现有包的标识声明，不自动导出对应包或证明已通过执行安全审核。

### 客户申请与使用权

Shroom 本地后端注入已激活的软件 `licenseKey`，网页不得直接持有此凭据。服务端严格核验在线或离线密钥、有效产品和客户关联，用数据库中稳定的 customerId 作为归属；密钥不写入算法平台表或日志。软件密钥到期/撤销时不接受新商业请求。

- `POST /requests {licenseKey,idempotencyKey,productId,versionId,kind,goal}` → `{request:{id,status},notice?}`。kind 为 `quote|trial|custom`，goal 最多2000字且必填，idempotencyKey 遵循 ID 格式。相同客户+编号+内容重试复用回执；改内容返回 `IDEMPOTENCY_CONFLICT`。禁止传 customerId 等身份字段。
- `POST /entitlements {licenseKey}` → `{items,notice}`；只返回该客户已确认收款的记录，禁止指定其他客户或订单。每项为 `{id,productId,versionId,product,status,deviceLimit,expiresAt,deliveryReference}`，status 为 `awaiting_delivery|delivered|expired`；expiresAt 为 ISO 时间或 null。无金额、收款引用、员工身份或财务明细。摘要不是签名执行许可，不足以绕过宿主的安装/执行准入。

### 管理工作台

仅网站会话使用，员工令牌不得进入工作台。

- `GET /admin/workspace` → `{submissions,requests,orders,customers,capabilities:{review,finance}}`。无审核职责看不到其他提交、需求和客户，无财务职责看不到订单。
- `POST /admin/submissions/:id/review {decision:'publish'|'reject',note}`。note 必填最多1000；仅独立超管处理待审版本。
- `POST /admin/requests/:id/status {status:'reviewing'|'cancelled',note}`。note 必填最多1000，仅超管。
- `POST /admin/orders {requestId,amountMinor,currency,deviceLimit,expiresAt,terms}`。仅财务；amountMinor 为 0～10¹² 整数，currency 为3位大写代码，deviceLimit 为1～100000整数，expiresAt 为未来 ISO 时间或 null，terms 必填最多4000。customerId/productId/versionId 从已登记需求读取，不允许调用方篡改。
- `POST /admin/orders/:id/payment {receiptReference}`。仅 quoted 订单，凭据必填最多2000。
- `POST /admin/orders/:id/delivery {deliveryReference}`。仅 payment_confirmed 且未过期订单，凭据必填最多2000。
- `POST /admin/orders/:id/cancel {note}`。仅未收款 quoted 订单，原因必填最多2000。

当前工作台/目录为首期列表，每种记录最多取最新1000项，使用权查询先按客户过滤后取1000项；扩量前须补游标分页、检索和独立运营报表，不能将列表数量当成全量财务统计。管理工作台错误使用显著提示并保留当前输入，操作后刷新真实状态。

## 验证与发布验收

隔离内存资料库仅位于 `server/testing/algorithmPlatformFixture.ts`，不用于生产。单测覆盖白名单、自审/归属/财务边界、不可变版本、幂等、并发重试、收款后交付、期限和真实 HTTP；内存队列用于验证业务竞争结果，不构成 MySQL 真机锁验证。

本轮不访问线上或运行迁移。上线前仍需在隔离 MySQL 应用0024后验证真实并发、备份恢复，并用真实独立账号走一笔人工试点，核对交付证据和客户安装结果；退款、结算与自动运行许可不应以本期记录能力替代。
