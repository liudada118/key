# 桌面端设备授权和独立网页发布

核对日期：2026-10-14。对应本仓库服务端和 `E:/shroom1` 的 `agent` 分支，当前尚未部署。

## 部署顺序

1. 备份数据库，部署服务端代码并执行 `pnpm db:migrate`。本次增加 `0020_license_device_limits.sql`：`license_device_policies` 和 `license_devices`，分别按密钥类型/ID、密钥类型/ID/电脑摘要建立唯一约束。
2. 保留现有 `SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH`，必须是与桌面端内置公钥配对的 Ed25519 私钥；不要重新生成不匹配的密钥。
3. 配置 `SHROOM_FRONTEND_RELEASE_DIR=/data/html` 为独立、持久的前端发布目录。现有部署工作流创建服务器绝对路径 `/data/html`，写入 `.env` 并通过 PM2 更新环境，目录在仓库外，后续部署不会删除历史版本。
4. 发布一次包含设备授权、网页缓存及统计 IPC 的新版 Shroom 安装包。只有前端源码更新不能改变旧软件的主进程能力。
5. 用测试客户验证同机升级不重复登记、超额拒绝、解绑与恢复、暂时断网；最后发布兼容网页并确认完整缓存、下次启动及失败回退。

本轮没有执行生产迁移、读取生产私钥、发布前端版本或替换客户安装包。

## 管理电脑数量

`super_admin` 在在线/离线密钥列表的“电脑授权”按钮中设置上限、查看电脑摘要后 8 位和最近验证时间，并解绑/恢复。0 默认不限量，设置范围 0–10000。降低到低于已登记数量时先解绑，恢复也遵守上限；操作沿用审计日志。

`POST /licenseCheck` 增加 `deviceId` 入参，数据库有效的密钥按策略登记并返回 `deviceLimit` 与 `deviceLease: { lease, signature }`。有效的现代客户端得到最长 7 天、绑定电脑和密钥摘要、且不超过密钥有效期的签名凭证。无电脑 ID 的旧调用只有在不限量时兼容；有限数量时返回 `DEVICE_ID_REQUIRED` 和过期结果，避免旧远程验证缓存误判。更老的纯本地验证客户端必须升级，服务端无法追溯强制限制它们。

策略行在事务中先 `SELECT … FOR UPDATE`，计数、登记、解绑和恢复使用同一策略锁，避免同一名额被并发领走。已解绑电脑不能自动重新登记；同一电脑重复验证更新最后验证时间，不占新名额。数据库或签名配置不可用时返回服务不可用，不降级取消限制。

签名凭证最长离线 7 天，因此解绑无法即时触达断网电脑。即使当前策略不限量，新版在线客户端也保留有期限的凭证，以便后续改变数量策略或吊销。

### 离线密钥

默认仍生成原来的不限量 RSA 离线码。生成页增加电脑数量输入；大于 0 时签发 v4，签入 `deviceLimit` 和 `boundSensorTypes`，新版客户端通过 `POST /api/license/devices/check` 验证服务器登记记录、RSA 签名、状态与到期时间，然后登记电脑并取得短期签名凭证。

v4 故意使用新授权范围字段：不支持设备授权的旧客户端不能把它当作无限制离线码接受。公司系统包授权解析也支持 v4 的签名范围。旧不限量离线码没有签入这一机制，不能仅改数据库追加数量限制；网站会提示重新签发。不要向客户把“有限设备的离线码”描述成永久不需要联网。

## 独立发布前端网页

先在桌面项目按现有 Vite 配置构建前端，完成业务回归。将构建目录传至发布服务器，在 `E:/key` 对应部署仓库运行：

```bash
export SHROOM_FRONTEND_RELEASE_DIR=/data/html
export SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH=/opt/key-manager-secrets/system-package-private.pem
pnpm exec tsx scripts/publish-frontend-release.ts /path/to/shroom/build 1.1.37
```

第二个参数必须填写实际支持这些功能的最低安装包版本。上面的版本只演示格式；仓库仍为 1.1.37，发布新安装包时应按正式发版流程增加版本号，并使用那个版本。可传第三个正整数参数指定 `releaseId`，否则使用当前毫秒时间；每次新版本 ID 必须递增。

网页构建资源可先上传到 `/opt/shroom-web-upload/build/`，再将这个目录作为脚本的第一个参数。正式发布目录由脚本生成：

```text
/data/html/
├── latest.json
└── 版本ID/
    ├── release.json
    ├── index.html
    └── assets/
```

`latest.json` 与 `release.json` 由服务器发布脚本签名生成，只有完整发布完成才更新最新版本入口。`/data/html` 是服务器磁盘路径，HTTP 下载继续由已定义的前端更新接口提供。此路径变更尚未部署，旧正式目录如已有版本也需在部署时核对迁移。

脚本先枚举、校验、签名并复制完整资源，再原子替换 `latest.json`。发布 ID 不可覆盖，失败不会改动现有 latest；不完整目录可保留排查，重试使用新 ID。`model/`、`models/`、`uv/`、`.map`、隐藏文件和 `config.txt` 排除，继续由兼容安装包提供。只接受安全路径、含 index.html 与 JS 的构建，限制 2000 文件、64 MiB/文件、256 MiB/版本。发布目录不能与输入构建目录重叠。

| 路由 | 行为 |
| --- | --- |
| `GET /api/frontend/latest` | 返回签名清单，服务端复验签名；`no-store`；未配置时 503 JSON |
| `GET /api/frontend/releases/:id/*` | 仅提供该版本清单登记的资源，保持正确 MIME；不可变缓存；不存在时 404 JSON |

客户端以安装包内公钥验证签名和每个文件的 SHA-256；无网继续使用本地页面，新版后台缓存后下次启动启用，运行中不替换 JS/CSS，启动确认失败回退。需要新增 IPC、原生依赖、Python 能力或模型资源的版本必须先更新安装包。前端清单的 `hostContract: 1` 只支持当前宿主契约。

## 使用统计和错误上报

服务端沿用现有 `/api/usage/events/batch`、`usage_*` 表、`/usage-analytics` 超管统计页面。本轮主要新增桌面采集端，无新增统计表。首次使用默认开启，客户在软件“应用设置”可查看上传范围并关闭，升级保留已保存的开关选择；与 Agent 聊天同步独立。

首批埋点：会话、系统进入与停留、串口连接、采集开始/结束与时长、回放启动、CSV 导出、Agent 任务结果，以及公共后端日志、页面和 Electron 异常。上传有限属性和脱敏错误，不包括聊天、原始帧、附件或自定义系统名称；切换密钥隔离队列，以确实送达的事件 ID 做幂等回执。

统计鉴权目前只接受已登记的在线软件密钥；RSA 离线密钥暂不适用。数据库归属、客户状态和超管读取权限仍由原服务端实现校验。

## 检查命令和未验证项

```bash
pnpm check
pnpm test
```

真实数据库并发测试只使用显式给出的本机管理员连接，并在临时数据库建表/删库，不操作业务库：

```bash
DEVICES_TEST_ADMIN_URL=mysql://test_admin:password@127.0.0.1:3306 pnpm exec vitest run server/licenseDevices.integration.test.ts
```

也可复用现有的 `USAGE_TEST_ADMIN_URL`。不要将真实凭据写入文档、提交或命令日志。

常规测试、TypeScript 和临时生产构建已运行；电脑并发 MySQL 测试在当前环境跳过。部署后还需验证实际网站操作、多电脑名额、客户端升级/离线、统计授权归属和网页缓存更新。测试通过不代表服务器已经更新。
