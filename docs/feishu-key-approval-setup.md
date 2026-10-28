# 飞书群内密钥审批配置

系统支持由飞书应用机器人向指定超级管理员群发送交互卡片。群内点击“同意并生成密钥”或“拒绝”后，服务端直接完成审批，不需要登录网站。

## 1. 开启应用能力和权限

在飞书开放平台进入当前企业自建应用：

1. 在“添加应用能力”中开启“机器人”。
2. 在“权限管理”中开通“以应用的身份发消息”。
3. 为了读取机器人所在群并取得 `chat_id`，开通群聊只读权限 `im:chat:readonly`。
4. 创建并发布一个应用版本，使机器人能力和权限生效。
5. 在飞书客户端把该应用机器人加入只供超级管理员使用的审批群。

权限开通后，在项目目录运行：

```bash
pnpm feishu:list-chats
```

命令只会输出机器人可见的群名称、状态和 `chat_id`，不会输出 App Secret 或访问令牌。将审批群对应的 `oc_...` 写入 `FEISHU_APPROVAL_CHAT_ID`。

## 2. 配置卡片回调

先将当前飞书应用的 Verification Token（以及已设置的 Encrypt Key）填入服务器 `.env` 并重启加载。不要把这些值发到聊天、日志或提交到 Git。URL 校验只需要正确的验证配置，不要求审批群已设置或数据库可用；但真正同意/拒绝时仍须配置 App ID 和审批群。

在应用的“事件与回调”页面：

1. 选择“将回调发送至开发者服务器”。
2. 回调地址填写：

```text
https://shroom.jq-industries.com/api/feishu/key-request/card-action
```

3. 添加新版“卡片回传交互”回调 `card.action.trigger`，不要同时添加旧版回调。
4. 在“加密策略”中复制 Verification Token 和 Encrypt Key。

服务端支持加密回调。配置 Encrypt Key 后会同时校验请求签名、五分钟时间窗口、Verification Token、App ID 和审批群 `chat_id`。

URL 验证请求必须是 `type: "url_verification"`，校验 Token、按需解密后原样返回 `{ "challenge": "收到的值" }`。真正的卡片事件即使夹带 `challenge` 字段，也不能跳过签名检查或执行未授权审批。

如果配置时仍提示 Challenge code 未返回，检查接口 HTTP 状态：

- 503：服务器缺 Verification Token；旧版本也可能因审批群未设置而提前拒绝，需要先部署本次修复。
- 401：Verification Token 不匹配，或真正卡片回调缺少有效签名。
- 400：请求结构或密文错误，检查两端 Encrypt Key 是否一致。
- 返回 HTML、404 或重定向：检查反向代理路径；不要把网站登录地址用作回调地址。

## 3. 本地环境变量

`.env` 中填写：

```dotenv
FEISHU_APPROVAL_CHAT_ID=oc_审批群ChatId
FEISHU_VERIFICATION_TOKEN=飞书应用VerificationToken
FEISHU_CALLBACK_ENCRYPT_KEY=飞书应用EncryptKey
FEISHU_APPROVAL_REVIEWER_USERNAME=系统中的超级管理员用户名
```

`FEISHU_APPROVAL_REVIEWER_USERNAME` 可留空；留空时使用系统中 ID 最小的启用状态超级管理员作为审计账号。生产环境建议显式填写。

本地地址无法被飞书服务器直接访问。正式验证应使用生产域名，或使用具备 HTTPS 公网地址的内网穿透服务。

## 4. GitHub Actions Secrets

在 GitHub 仓库的 Actions Secrets 中创建同名配置：

- `FEISHU_APPROVAL_CHAT_ID`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_CALLBACK_ENCRYPT_KEY`
- `FEISHU_APPROVAL_REVIEWER_USERNAME`

部署工作流会保留服务器已有 `.env`，仅首次缺少文件时从 GitHub Secrets 创建。后续修改飞书配置应更新服务器 `.env`，再通过 PM2 的 `--update-env` 重启加载。

## 5. 验证

1. 使用普通账号提交一条无合同密钥申请。
2. 审批群应收到带“同意并生成密钥”和“拒绝”按钮的卡片。
3. 点击“同意并生成密钥”并确认。
4. 卡片应变为绿色“密钥申请已通过”，网站申请状态同步变为已通过，密钥归申请人所有。

如果应用卡片配置不完整或发送失败，系统会继续使用原有自定义机器人 Webhook 发送文本提醒，但文本提醒不具备群内审批能力。
