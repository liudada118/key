# 公司展示系统发布服务

密钥管理网站的“公司系统库”接收桌面 Agent 的系统审核包。员工凭登录会话或 30 天 `sps_` 限权令牌提交；只有超级管理员可以审核、发布与撤回。软件密钥仅能读取该客户已授权的目录和包，不能上传或批准。

部署前运行 `pnpm db:migrate`，应用 `0016_kind_puma.sql` 和 `0017_harsh_darkstar.sql`。通过 `SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH` 指定独立 Ed25519 私钥文件，公钥已固定在桌面软件的 `backend/extension-host/workspace/systemPackagePublicKey.pem`。私钥必须与该公钥配对、限制文件权限且不可放入仓库或安装包；未配置私钥时发布与客户目录接口会拒绝服务。数据库应允许至少 18 MiB 的单次包写入，HTTPS 反向代理也须允许相应请求体。

接口挂载在 `/api/system-packages`：`POST /submissions` 提交包；`GET/POST/DELETE /staff-tokens` 管理员工令牌；`GET /admin/submissions`、`GET /admin/submissions/:id`、`POST /admin/submissions/:id/{publish,reject,revoke}` 审核；`GET /client/catalog` 与 `GET /client/packages/:id/:version` 使用 `Authorization: License <现有软件密钥>`。目录签名绑定密钥哈希并最多有效 24 小时；包另有内容摘要签名。客户必须关联启用中的客户记录，密钥状态须为已签发、已激活或已续期且未过期。

目前交付 `manifest` 与 `native-template` 两类包。Manifest 仅接收 JSON 配置和已测试的受限 Python 分类器声明；引用外部脚本、模型或 Agent 自定义渲染器的包会在桌面导出时拒绝。原生模板副本在客户端还必须拥有对应内置 `sourceType`，否则需要先发布新的安装包。
