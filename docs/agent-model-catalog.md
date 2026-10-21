# Agent 模型服务商与模型目录

桌面端通过公开目录读取“模型服务商”和“模型名称”选项。目录只分发元数据；不代理模型请求、不存储客户 API Key、不改变模型访问权限。客户仍使用自己的 Key 直接访问所选模型服务。

## 接口

`GET /api/agent/model-catalog`

例如正式服务的完整地址为 `https://shroom.jq-industries.com/api/agent/model-catalog`。接口无需登录或软件密钥，直接返回 JSON，不使用 tRPC/envelope 包装。响应设置 `Cache-Control: no-cache` 与公开只读 CORS。HEAD、OPTIONS 可用；其余方法返回 405，不能用此接口修改服务器文件。

```json
{
  "schemaVersion": 1,
  "version": "company-2026-10-20-1",
  "providers": [
    {
      "id": "company",
      "label": "公司模型服务",
      "baseUrl": "https://models.example.com/v1",
      "defaultModel": "example-model",
      "models": [
        { "id": "example-model", "label": "示例模型" }
      ],
      "hint": "填写此服务签发的 API Key。"
    },
    {
      "id": "custom",
      "label": "自定义地址／中转站",
      "baseUrl": "",
      "defaultModel": "example-model",
      "models": [
        { "id": "example-model", "label": "示例模型" }
      ]
    }
  ]
}
```

本目录版本仅支持现有 Responses API 兼容服务；增加一个模型名称不会自动实现新协议，也不保证账号有该模型权限。`version` 是运营版本标识，每次更新请修改，便于诊断。删除目录项不应被当作远程撤销客户已保存地址/模型的方式。

## 配置位置与更新

服务按照以下优先级读取文件：

1. `SHROOM_AGENT_MODEL_CATALOG_PATH` 指定的绝对文件路径。
2. 已部署 `dist/index.js` 旁的 `dist/config/agent-model-catalog.json`。
3. 当前工作目录下的 `config/agent-model-catalog.json`，用于源码开发。

推荐生产环境使用独立配置：

```text
SHROOM_AGENT_MODEL_CATALOG_PATH=/data/agent/model-catalog.json
```

首次配置此环境变量后，按现有流程重启服务一次以加载环境变量。以后只需要更新 JSON，不需要重新编译服务或重新打包客户端；服务器在每次 GET 时重新读取。只更新默认 `dist/config` 的文件也会生效，但下次整体部署会被默认文件替换，因此长期运营应使用外置路径。

部署者先从 `config/agent-model-catalog.json` 复制一份默认清单到目标目录，目录只允许受信任的部署账号写入。修改时写同目录临时文件，再原子替换正式文件，避免请求读到半份 JSON：

```sh
# edited-catalog.json 为已检查且不含凭据的完整目录。
install -m 0644 edited-catalog.json /data/agent/.model-catalog.pending.json
mv /data/agent/.model-catalog.pending.json /data/agent/model-catalog.json
curl --fail --silent --show-error https://shroom.jq-industries.com/api/agent/model-catalog
```

执行替换前保留旧文件副本。若验证失败，原子恢复旧文件即可，不必重启客户端或服务端。当前实现不提供在线编辑界面或写入接口，配置运营由部署人员完成。`scripts/build-deploy.mjs` 会在完整发布产物中携带默认目录；普通源码运行也能直接读取仓库配置。

## 校验与故障行为

目录最大为 128 KiB UTF-8；顶层只能包含 `schemaVersion`、`version`、`providers`。服务商只能包含 `id`、`label`、`baseUrl`、`defaultModel`、`models`、可选 `hint`，模型只能包含 `id`、`label`。任何未知字段（包括 `apiKey`、`token`、`credential`）都会使目录被拒绝，不会过滤后继续公开。

- 服务商最多 32 个，每个最多 100 个模型，两者都不能为空；服务商 ID 和每个服务商内的模型 ID 不得重复。
- 服务商 ID 最长 40 字符，以小写字母开头，后续仅允许小写字母、数字、下划线和短横线；标签最长 100；模型 ID 最长 120；版本最长 100；说明最长 500。
- 字符串不得含控制符；必填文字不得有首尾空白或为空。说明可省略、为空串，或填写最多 500 字符内容（去除首尾空白后返回）。
- `defaultModel` 必须出现在该服务商的模型列表中。
- 必须保留且只能有一个 `id: "custom"` 的自定义入口，其 `baseUrl` 必须为空。
- 其他服务商地址必须为 HTTPS，最长 1000 字符，不得带用户名、密码、查询参数或片段。不要把 API Key 放进 URL。

文件缺失、不可读、编码错误、过大、JSON 或字段校验失败时，接口统一返回：

```json
{ "error": "AGENT_MODEL_CATALOG_UNAVAILABLE" }
```

状态码为 503，不返回文件路径、原始配置或校验细节。无效的外置配置不会静默退回默认目录；客户端应保留最近可用目录或内置清单，不能因此清空已有设置。默认目录来自同一版本桌面端的 `shared/agent-model-catalog.json`；模型可用性仍以具体服务、账号和实测为准。

## 本地验证

```powershell
.\node_modules\.bin\vitest.cmd run server/agentModelCatalog.test.ts
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
```

专项使用临时配置与本地随机端口，覆盖默认目录、外置路径优先、原子热更新、校验失败、凭据字段拒绝、超限、GET/HEAD/OPTIONS 和 405；不会请求模型服务，也不会连接生产数据库。
