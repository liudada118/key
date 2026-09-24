# 客户功能使用与错误上报接收服务

实现日期：2026-09-24。本文描述已实现代码；生产数据库迁移、服务发布与客户真机上传尚未执行。

## 接入与部署顺序

1. 在目标环境审查并备份数据库，执行仓库既有迁移流程，使 `0013`、`0014`、`0015_usage_analytics.sql` 按序生效；不要跳过原有迁移记录或手工重复执行。
2. 发布包含 `server/usage.ts` 的后端和后台页面；反向代理允许 `POST /api/usage/events/batch`、`Authorization` 头、256 KiB 请求体，并将读取超时设为大于 12 秒。
3. 内部测试安装使用有效且已登记的软件密钥，启用客户端统计并完成操作；用启用中的超级管理员登录“监控与安全 → 客户使用分析”（`/usage-analytics`），选择正确环境和日期。
4. 确认断网后补传、重试无重复、客户及安装归属正确，再扩大客户范围。

此功能没有新增线上环境变量，也不会自动创建表。未迁移时上传返回可重试的 `503 STORAGE_UNAVAILABLE`。目前复用在线软件密钥身份；仅有离线 RSA 授权、没有服务器可验证软件密钥的安装不在此接收身份范围。

## HTTP 契约

`POST /api/usage/events/batch`，`Content-Type: application/json`，`Authorization: License <软件密钥>`。鉴权先于正文解析，不支持 Bearer 上传凭证。客户端不能自报客户归属。

```json
{
  "schemaVersion": 1,
  "events": [{
    "schemaVersion": 1,
    "eventId": "53b42c32-4a77-4a9e-bf46-d420357301e1",
    "installationId": "2194d6f6-7c2c-4947-ad8b-66bef9ecaa6e",
    "sessionId": "d3f3ba86-c760-4e08-a0f5-f980393d80de",
    "occurredAt": "2026-09-24T06:30:00.000Z",
    "appVersion": "1.1.37",
    "environment": "production",
    "eventName": "export_result",
    "properties": { "featureId": "export", "format": "csv", "result": "success", "durationMs": 1200 }
  }]
}
```

权威字段定义在 `server/usageSchema.ts`。批次 1–50 条、正文 ≤256 KiB、每事件 JSON UTF-8 ≤4 KiB。所有对象拒绝额外字段。ID 必须为 UUID，时间是带时区 ISO 时间；版本最多 80 字符；环境为 `production/development/test`。`properties` 必须是对象，可为空；属性标识采用 `[A-Za-z0-9_.:-]{1,80}`。

事件：`app_session_started`、`feature_exposed`、`feature_attempted`、`system_entered`、`device_connection_result`、`monitoring_usage_summary`、`collection_started`、`collection_finished`、`export_result`、`playback_started`、`algorithm_result`、`analysis_tool_used`、`custom_system_saved`、`agent_task_result`、`usage_session_summary`、`error_reported`。

共同可选属性：`featureId/systemType/systemOrigin/operationId/result/durationMs/count/format/errorCode/connectionType/mode/algorithmId/module/action/errorType/severity`。其中 `durationMs` 为有限数 0–86400000；`count` 为整数 0–1e12；`systemOrigin=builtin/copy/custom`、`result=success/failure/cancelled/unknown`、`format=csv`、`connectionType=serial/halow/unknown`、`mode=realtime/playback`、`severity=warning/error/fatal`。只有 `error_reported` 可以携带 `message`（≤400 字符）、`stack`（≤1800 字符）；仍受总字节限额约束。

服务端再次脱敏错误里的凭据、密钥样式、邮箱、URL 和常见绝对路径；凭据键值对覆盖 JSON、单双引号、空格和转义引号，不保留密码的后半段。不要把任意客户正文放入这些字段。普通事件不接受文件名、原始传感矩阵或聊天正文。日志不输出请求、授权头、错误正文或 SQL 异常。

仅在事务持久化成功后返回：

```json
{ "accepted": true, "eventIds": ["53b42c32-4a77-4a9e-bf46-d420357301e1"] }
```

返回 ID 保留本次请求的原始拼写及顺序。客户端必须按精确 ID 确认后再删队列。相同来源、安装和事件 ID 的相同内容重传正常确认；不同内容返回 `409 EVENT_CONTENT_CONFLICT`，整批回滚。超时可能发生在事务已提交之后，重传仍然安全。

| 状态 | 含义 |
| --- | --- |
| 400 | JSON/字段/事件字节限额错误；隔离坏事件，避免无限重试 |
| 401/403 | 缺少或失效软件密钥、授权状态或客户不可用 |
| 409 | 同一回执对应不同内容；整批未确认 |
| 413/415 | 正文过大、内容类型或压缩编码不支持 |
| 429 | 每进程每来源超过 60 批/分钟；遵循 `Retry-After: 60` |
| 503 | 存储不可用或 12 秒接收超时；退避重试 |

## 数据归属与统计口径

`usage_sources` 在首次成功批次中保存来源 ID、客户 ID 和公司名快照。来源复用 `agent_chat_sources` 对软件密钥的稳定映射，但展示不再动态关联密钥当前的客户。公司名称或密钥关联后续变化不会改变这份历史快照；同一密钥后续事件继续属于这一来源。公司重新归属应签发另一密钥，而不是借修改历史绑定转移行为记录。

`usage_events` 的 `(source_id, installation_id, event_id)` 同时作为不可变事件与去重回执。原始输入仅用于 SHA-256 内容摘要；持久化正文已脱敏。日期按事件时间 UTC 分桶，接收时间另存；离线补传可能改变过去日期的统计。

- 客户数：不同客户 ID；未绑定公司的密钥来源分别统计，绝不混为一个“匿名客户”。
- 安装数：来源与安装 ID 的组合数，并非物理电脑数，也不是人员数。
- 事件数：去重后的记录数；曝光、尝试、业务完成分开列出。
- 活跃天数：至少有一条匹配事件的 UTC 日期数，不代表人在电脑前的操作时长。
- 错误次数：`error_reported` 的 `max(1,count ?? 1)` 之和，兼容客户端在 60 秒内合并的重复错误。
- 不同错误：脱敏后的模块、类型、错误码、消息、堆栈组合摘要数；这不是根因分析。
- 监测时长只加 `monitoring_usage_summary.durationMs`；采集时长只加 `collection_finished.durationMs`，避免同时叠加会话汇总。

后台查询最长 93 天，默认近 30 天且只看正式环境。概览聚合所有匹配事件；功能和客户列表最多显示前 100 项（页面标明），时间线每页 50 条。错误上下文最多 20 条且同时匹配来源、安装、会话，只读取出错前/当时事件。所有接口均要求启用中的超级管理员，并设置 `Cache-Control: no-store`。

当前直接基于有索引的原始事件聚合，没有额外每日汇总表、自动删除历史或外部告警推送。数据量扩大后再根据真实查询耗时引入每日汇总与明确的保留期限。无数据只能表示尚未观测到，不能判断客户停用或没有功能权限。

## 本地验证

- `server/usage.test.ts`：8 项 HTTP/字段/正文/速率/提交后确认/脱敏测试。
- `server/usageRouter.test.ts`：2 项启用中超管权限、时间范围与完整事件身份测试。
- `server/usage.integration.test.ts`：5 项真实 MySQL 事务、并发去重、冲突回滚、跨客户安装隔离、历史归属、错误累计与会话上下文、授权状态测试。
- 集成测试必须显式设置 `USAGE_TEST_ADMIN_URL`，且只能是本机地址。测试创建随机 `usage_test_*` 数据库，只删除自己创建的库。不要传生产数据库连接。
- `pnpm exec tsx scripts/usage-desktop-fixture.ts` 启动跨仓桌面夹具：真实 HTTP 路由和白名单，仅接受固定合成密钥 `"ab".repeat(64)`，不读取数据库。stdout 首行 `{ "port": 随机本机端口 }`；`GET /fixture/events` 返回 `{events:[脱敏事件]}`，stdin 输入 `close` 或关闭 stdin 停止。该调试路由只存在于独立测试脚本。
- 2026-09-24 已在独立临时 MySQL 8.4 数据目录完成首轮 14 项专项测试及原有聊天同步的 10 项集成测试；TypeScript 与系统临时目录 Vite/esbuild 构建通过。该轮完整仓库 155/155 通过；首次运行原有随机篡改密钥测试失败，未修改 crypto 文件，单独重跑和全套均通过。
- 浏览器使用合成响应检查 1440 桌面和 375 手机宽度、浅深色、空数据、错误调用栈和上下文、低权限不发统计请求；无页面异常和文档水平溢出。它不代表线上真实客户数据已经接通。
- 同日审查追加一项带空格和转义引号的完整凭据值回归；脱敏加固后 HTTP/权限相关 10 项通过，完整套件现为 156 项（新增回归后未重复运行无关域）。
