# Agent 聊天同步服务

更新：2026-09-22。对应客户端契约 `E:/shroom1/docs/agent-chat-sync-api.md`。

## 接入

- 本地完整地址：`http://localhost:3005/api/agent/conversations`。
- 生产完整地址：`https://你的服务域名/api/agent/conversations`。使用实际部署域名，客户端不自动追加路径。
- 客户端在 Agent → 模型设置 → 聊天同步填写地址、独立上传凭证，启用后保存。
- `POST` 请求头：`Authorization: Bearer <上传凭证>`、`Idempotency-Key: <eventId>`、`Content-Type: application/json`。
- 本服务与密钥管理后端一起启动，不需要独立进程。

## 部署

```powershell
pnpm db:migrate
pnpm build
pnpm start
```

发布时执行已提交的 `0013_agent_chat_sync.sql`，然后重启应用。不运行 `db:push` 来代替迁移。
MySQL 必须使用 InnoDB，`max_allowed_packet` 建议至少 32 MiB。新增三张表；不修改已有聊天或授权记录。
HTTP 接收器先鉴权，再运行独立的 8 MiB JSON 解析器，注册在项目全局 50 MB 解析器之前。
仅接收非压缩 UTF-8 JSON。每客户、每服务进程最多 60 次/分钟，超限返回 429；多实例部署应在网关增加共享限流。
接口等待超过 12 秒返回 503；事务仍可能完成，客户端重试会通过持久化回执去重。

Nginx 在 HTTPS server 中增加以下精确路径配置；上游端口以服务器实际配置为准。应直接填 HTTPS 地址，不能依赖重定向。

```nginx
location = /api/agent/conversations {
    client_max_body_size 8m;
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 3s;
    proxy_read_timeout 15s;
}
```

不要记录 Authorization 请求头或聊天正文。应用错误日志仅记录固定错误码和客户 ID；409 日志可接入现有报警。

## 网页查看聊天

- 使用启用中的超级管理员登录，进入左侧“监控与安全 → Agent 聊天”，地址为 `/agent-chats`。
- 按客户筛选会话，点击会话查看用户和助手消息、消息时间、附件名称，以及任务状态和错误码。
- 会话按最近同步时间排序，每 30 秒刷新，也可以手动刷新；列表每页 20 个会话，消息和任务各每页 50 条。
- 只显示客户端已启用同步并成功上传的最新快照；不会主动读取客户端本地历史聊天。上传契约没有用户姓名，当前按客户、安装标识和会话区分。
- 消息以纯文本展示，不执行 HTML；附件仅有名称等元数据，不提供文件预览或下载。
- 服务端 `agentSync.chatCustomers`、`agentSync.conversations`、`agentSync.conversation` 均校验启用中的超管身份；普通管理员和子账号不可读取。

## 签发上传凭证

先在密钥系统“客户管理”中建立客户，使用其数据库 ID。`tenantId` 即该客户 ID，由凭证绑定；上传正文不能指定归属。

超管登录后的 tRPC 管理入口：

| 过程 | 类型 | 参数 |
| --- | --- | --- |
| `agentSync.issueCredential` | mutation | `{ customerId, name, days?: 90 }` |
| `agentSync.listCredentials` | query | `{ customerId }` |
| `agentSync.revokeCredential` | mutation | `{ id }` |

仅启用中的超级管理员可使用。签发返回 `{ id, token, tenantId, expiresAt }`，明文 token 只在此次签发返回；列表仅含前缀和状态，不返回摘要或明文。有效期 1～365 天，默认 90 天。

本地运维工具使用服务端 `.env` 中的数据库凭据，不是公开的身份认证入口。`--admin` 指定用于记录签发者的现有启用中超管用户名：

```powershell
pnpm agent-sync:credential issue --customer-id 123 --admin admin --name "客户工作站" --days 90
pnpm agent-sync:credential list --customer-id 123 --admin admin
pnpm agent-sync:credential revoke --id 456 --admin admin
```

把示例 ID、用户名换成现有记录。签发输出包含一次性可见 token，应直接交付对应客户，避免保存到共享日志。
此版本提供后端管理 API 和运维命令，尚未增加后台凭证管理页面。

每个凭证固定绑定一个客户，不能重新分配。轮换必须给同一客户签发新凭证。切换成其他客户会把客户端该地址的待发队列记到新客户名下，故不得混用或转交凭证；独立客户使用独立客户端数据目录。
客户停用、删除或上传权限失效会阻止继续上传；凭证过期/撤销返回 401。

## 校验与持久化

- 版本固定为 `1`，事件类型固定为 `agent.conversation.upsert`；拒绝所有层级未支持字段。
- eventId/installationId 为 UUID，其他 ID 为 1～160 位字母、数字或 `_ . : -`；会话内消息、任务、附件 ID 分别不能重复。
- revision 必须是正的 JavaScript 安全整数；时间须 ISO 格式；occurredAt 不参与覆盖判断。
- appVersion 最多 80 字符，文件名最多 255 字符；消息仅 user/assistant，任务 status 为 1～40 位小写字母/下划线，errorCode 为最多 80 位大写字母/数字/下划线且以字母开头。
- kind 接收 image/text/csv/json/xlsx/file，size 为非负安全整数；附件记录必须被消息引用。消息引用的本地附件已缺失时可不附带附件记录，与客户端序列化保持一致。
- 每快照最多 50,000 条消息、50,000 个任务、10,000 个附件，每条消息最多 10,000 个附件引用；另受整个请求 8 MiB 字节上限限制。

`agent_upload_credentials` 保存 SHA-256 token 摘要、客户、上传权限、有效期和撤销状态。随机 token 使用 32 字节随机数。
`agent_sync_events` 的 `(tenant_id, installation_id, event_id)` 唯一；对校验后的规范 JSON 求 SHA-256，字段顺序和空白不会造成冲突。
`agent_conversations` 的 `(tenant_id, installation_id, conversation_id)` 为主键，保存最新完整事件 JSON 和服务端 received_at。
ID 使用二进制排序规则，大小写不同的会话不会合并。

事件回执插入、摘要核验、最新快照原子更新在同一事务中。更大 revision 才能覆盖；旧版/同版本仍保存事件回执并确认。
重复事件返回相同确认，内容冲突返回 409；事务失败会回滚回执。提交成功后才返回：

```json
{"accepted": true, "eventId": "本次请求的事件 UUID"}
```

错误体仅含 `{ accepted: false, error: "固定错误码" }`。400 表示契约错误，401/403 表示鉴权失败，413 表示超过上限，415 表示媒体类型不支持，429 表示限流，503 表示存储故障或超时。
数据保留至后续定义清理策略；当前没有自动过期清理、聊天导出/恢复/删除接口。

## 验证

```powershell
pnpm check
pnpm exec vitest run server/agentSync.test.ts server/agentSyncRouter.test.ts
# 仅使用本机测试数据库管理员；测试自行建立并删除随机命名的测试库
$env:AGENT_SYNC_TEST_ADMIN_URL = 'mysql://root@127.0.0.1:3307'
pnpm exec vitest run server/agentSync.integration.test.ts
```

测试覆盖鉴权先于正文解析、8 MiB 边界、无效字段、权限、限流、错误 ACK 防护、并发重复、乱序版本、事务回滚、客户/安装隔离、大快照存储、查询分页和同步时间。网页已用临时数据验证桌面/手机布局、客户筛选、消息/任务分页及纯文本安全展示。生产 HTTPS 与实际 Electron 客户端接入需在部署后验证。
