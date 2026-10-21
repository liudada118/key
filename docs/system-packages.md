# 公司展示系统发布服务

密钥管理网站的“公司系统库”接收桌面 Agent 的系统审核包。员工凭登录会话或 30 天 `sps_` 限权令牌提交，也可只读获取已发布原包创建本机修订草稿；只有超级管理员可以审核、发布、调整客户版本与撤回。软件按有效密钥中的系统授权直接获取目录和包，无需额外关联客户；软件密钥不能上传或批准。

部署前运行 `pnpm db:migrate`，应用 `0016_kind_puma.sql`、`0017_harsh_darkstar.sql`、`0018_brief_fixer.sql` 和 `0019_handy_gwen_stacy.sql`。通过 `SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH` 指定独立 Ed25519 私钥文件，公钥已固定在桌面软件的 `backend/extension-host/workspace/systemPackagePublicKey.pem`。私钥必须与该公钥配对、限制文件权限且不可放入仓库或安装包；未配置私钥时发布与客户目录接口会拒绝服务。数据库应允许至少 18 MiB 的单次包写入，HTTPS 反向代理也须允许相应请求体。

生产部署保留已有 `/opt/key-manager/.env`，缺少文件时才从 GitHub Secrets 创建。先把现有配对私钥安全安装到生产机 `/opt/key-manager-secrets/system-package-private.pem`，使运行 PM2 的账号可读、其他账号不可读；不要生成一把与桌面端公钥不匹配的新私钥。部署流程会先检查该文件，并显式传入 PM2 重启环境；首次创建 `.env` 时也写入该路径。部署完成后，由 `super_admin` 在同一条待审提交上重新点击“确认发布”，确认状态变为“已发布”，再用目标客户的有效密钥刷新桌面系统列表。若仍是“待审核”，以页面内的发布失败提示排查，不必重新提交系统包。

接口挂载在 `/api/system-packages`：`POST /submissions` 提交包；`GET/POST/DELETE /staff-tokens` 管理员工令牌；`GET /staff/releases` 和 `GET /staff/releases/:systemId/:version` 使用员工 `Bearer` 令牌只读取得已发布包；`GET /admin/submissions`、`GET /admin/submissions/:id`、`POST /admin/submissions/:id/{publish,reject,revoke}` 审核；`POST /admin/releases/:id/activate` 由超级管理员指定客户当前版本。`GET /client/catalog` 与 `GET /client/packages/:id/:version` 使用 `Authorization: License <现有软件密钥>`。目录签名绑定密钥哈希并最多有效 24 小时；包另有内容摘要签名。密钥须已登记、状态为已签发/已激活/已续期且未删除或过期，授权范围须包含目标系统。

客户接口同时接受已登记的在线十六进制密钥和离线 RSA 激活码。离线码须与 `offlineKeys` 记录逐字一致，并使用该记录签发时的 RSA 公钥验签；服务端检查密钥状态、到期时间及签名授权范围。在线单个、批量和离线生成页选中公司系统或“全部授权”时均无需额外选择客户，限制电脑数量的入口也相同。合同带入或手工填写的客户只是业务元数据和可选版本覆盖，不作为公司包下载的授权条件；客户缺失、已删除或停用不会单独阻断仍有效密钥的公司系统范围。固定范围的旧密钥不会因新增公司系统自动扩大授权；`all` 沿用全部授权语义，分类授权仍按注册表展开，不自动授予不在该分类中的公司系统。未登记、签名无效、密钥停用、过期和系统未授权仍拒绝；这里的“离线码”仍需联网拉取系统包，完全断网的文件导入尚未实现。

目前交付 `manifest` 与 `native-template` 两类包。Manifest 仅接收 JSON 配置和已测试的受限 Python 分类器声明；引用外部脚本、模型或 Agent 自定义渲染器的包会在桌面导出时拒绝。原生模板副本在客户端还必须拥有对应内置 `sourceType`，否则需要先发布新的安装包。

系统 ID 冲突按“新系统”和“更新”分开处理。首次提交若撞到已发布 ID，接口返回 `SYSTEM_ID_ALREADY_PUBLISHED` 与当前版本号；员工必须明确以该版本为基线重试，或为新系统换 ID。内置系统 ID/传感器类型不可占用；同一 ID 同时只能有一个待审提交。提交记录保存 `base_version`，超级管理员审核页显示原版本并要求再次确认；发布事务锁定同 ID 全部版本，基线已变化时拒绝旧提案，避免两名审核员并发发布。客户端本机草稿或传感器类型冲突仍由安装器拦截，不覆盖草稿和已有采集数据；要解决时使用新的系统/传感器 ID 再提交，不能直接改客户历史数据的身份。

## 已发布系统的修订、推广与回退

员工可在桌面端公司系统库从已发布的签名包创建独立本机草稿，修改后带原 `systemId` 和 `baseVersion` 重新提交；正式受管系统始终只读。服务端拒绝同 ID 更新中传感器 ID、类型、输出通道或矩阵尺寸的破坏性变化，审核详情展示串口协议、线序文件及其他文件差异。需要改变这些输入身份时应新建系统 ID，不在已有客户采集记录上重新解释点位。

超级管理员审核首次发布时建立默认基线；后续审核只形成候选版本，不切换任何客户。`system_package_rollouts` 记录该系统的交付版本：`customer_id=0` 是全体默认版本，已关联客户的专属指针优先。管理页可选择任一仍已发布的版本，向指定客户推广，或把指定客户指回旧版；“全部客户”操作会清除客户专属覆盖并要求二次确认。目录和下载先按密钥系统范围筛选，再解析版本。未关联客户时使用全体默认版本；历史系统没有适用指针时保留最新已发布版本的读取兼容；部署前用下述幂等回填冻结默认基线，后续 publish 事务也会在审核新候选前补齐旧默认。忽略历史 `audienceJson` 客户名单，不能再要求给密钥额外分配客户。已有明确指针指向撤回或缺失版本时仍停止交付，不自动选择其他版本。

“按客户回退”与“紧急撤回”是不同操作：回退让指定客户在下次同步时安装已签名旧版；撤回将目标版本移出目录并停止新下载；已安装版本按下文明确的撤回模式与签名状态处理，不会自动选择别的版本。目录缓存最长 24 小时，桌面通常每 6 小时复查，也可在系统列表手动刷新；管理页操作不能保证立即断开离线客户。生产上线须先完成 `0019` 迁移与签名服务部署，再用真实 MySQL 和客户密钥验收推广、回退及撤回事务。


## 2026-10-19 候选发布与策略诊断

- `POST /admin/submissions/:id/publish` 仍由启用中的 `super_admin` 审核，状态仍为 `published`，包的 schema、摘要与签名保持不变。首次发布建立 `customer_id=0` 默认；后续只审核为候选，保留全体及客户指针。旧请求的 `audience` 字段接受但不执行投放；只有显式 `POST /admin/releases/:id/activate` 改变客户目标版本。
- publish 和 activate 使用同一系统的修订行锁顺序。publish 在缺默认指针时先冻结发布前的最新有效版，只有无历史发布才以本次版本建立默认；显式指向撤回版本的默认绝不覆盖。审核仍检查 baseVersion，推广仍检查 expectedRolloutToken。
- 管理页区分“审核为候选”和“首次默认发布”，审核时不选择客户。首次影响持相应授权且没有专属覆盖的密钥；候选审核影响零个现有目标版本；推广时才选择客户或全体，后者继续清除客户覆盖并要求确认。
- 部署前先执行 `pnpm exec tsx scripts/backfill-system-baselines.ts --admin-id=<启用中的超级管理员ID>` 预览；核对后加 `--apply`。只补缺失的全体指针，不改客户覆盖、不覆盖撤回指针，重复执行不改已完成系统；有界最多1000个系统，达到上限停止扩大推广并制定分页计划。普通 catalog 请求只读，不偷偷改生产状态。
- `GET /api/system-packages/client/policy` 使用原 License 鉴权，返回 `{ policy, signature }`。签名对 `JSON.stringify(policy)` 的 UTF-8 字节使用同一 Ed25519 私钥，客户端必须验签、核对 keyHash 和 issuedAt/expiresAt；policy 只能用于诊断，`diagnosticOnly:true` 不授予采集、导出或额外系统权限。字段包括 schemaVersion、policyVersion、serverVersion、publicationMode、withdrawal、catalogTtlHours、deviceLeaseMaxDays 和 retention。服务端提交标识来自 KEY_MANAGER_BUILD_SHA，不暴露部署路径和凭据。旧 catalog 签名结构不变。

### 迁移与回退

1. 备份数据库、确认当前默认与客户指针，保留旧服务端部署和配对私钥。
2. 先部署迁移与新版服务，再执行默认指针预览/回填；publish 自带事务补齐作为后备，但不能把 catalog 读取当迁移。
3. 用真实目标密钥验证首次默认、候选零投放、指定客户/全体推广、回退、撤回、无客户关联与旧客户端读取。
4. 回退服务端代码可保留已补齐的默认指针（它们就是回填时原本交付的版本）；不要删除默认以恢复“跟随最新”，也不要回退签名包字节。旧版 publish 会重新自动推广，回退期间暂停审核发布。
5. 清理迁移及数据删除的不可逆边界见 `upload-data-retention.md`。本轮只验证本机隔离MySQL，未部署生产。


### 按确切版本选择撤回效果

`POST /admin/submissions/:id/revoke` 新增可选 `withdrawalMode`（默认 `stop-distribution`）、`reason`（最多400字符）：

- `stop-distribution`：目录与新下载停用；支持新版契约且已安装、包hash一致的客户端可凭有效已安装状态继续使用。
- `stop-new-acquisition`：目录与新下载同样停用；客户端下次取得此确切版本状态时禁止新采集，当前采集停止新增接收并有序提交原库，历史查看/回放保留。

不改变同一systemId的其他版本，不自动切旧版。已撤回版本可显式选择模式再提交，追加 `withdrawal-policy` 审计；无mode的旧重复请求不会把强限制降回默认。管理页明确两种效果并默认选停止交付。离线和未支持新契约的旧客户端不能据此承诺即时生效；旧客户端沿用原保守目录规则。

`POST /api/system-packages/client/installed-status` 使用原License鉴权，请求 `{systems:[{id,version}]}`，1～32项、身份去重、严格字段。响应 `{grant,signature}`，签名是 JSON.stringify(grant) 的UTF-8字节，仍用同一Ed25519公钥：

```json
{"schemaVersion":1,"type":"installed-system-status","issuedAt":1792370000000,"expiresAt":1792456400000,"keyHash":"64位sha256","systems":[{"id":"seatpad","version":42,"status":"revoked","sha256":"包摘要","withdrawal":{"schemaVersion":1,"mode":"stop-distribution","effectiveAt":1792370000000,"reason":"维护"}}]}
```

- expiresAt最多24小时且不超过当前密钥到期；客户端还必须核对keyHash、时间、请求身份及本机已安装签名包hash，不能用它授权未安装包。设备凭证及密钥范围仍独立生效。
- status为published/revoked/unavailable/unauthorized。未授权只回显请求身份，不查询或泄露该版本信息；不存在或待审为unavailable，两者sha256和withdrawal均null。
- 已撤回旧记录缺少新版withdrawal对象时按既有停止交付解释；损坏的显式策略保守返回停止采集，不能静默放宽。
- 本grant是已安装版本状态证据；`/client/policy` 的diagnosticOnly仍只用于诊断。普通catalog仍只列可下载版本，缺项本身不能证明已安装版需要停机。
- 旧服务404、接口失败或验签失败不产生新许可；客户端保持原保守逻辑，不能把失败当作停止交付继续使用的证明。缓存只在其签名、密钥/包身份和期限均有效时使用，明确拒绝须撤销对应缓存。
