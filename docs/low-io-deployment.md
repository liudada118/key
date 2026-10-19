# 低 I/O 部署

更新日期：2026-10-19。本轮未提交、推送、重跑线上CI或清理生产文件。

## 发布路径

1. GitHub runner 安装依赖、检查、测试和构建前端。
2. `pnpm build:deploy <新输出目录> <40位提交SHA>` 将运行时及迁移器连同依赖打包为两个 Node ESM 文件。开发用 Vite 改为仅开发分支动态加载，生产包不含 Vite、TypeScript 或 drizzle-kit。
3. 输出只含 `dist/index.js`、`migrate.js`、模块类型声明、静态网页、授权注册表、迁移SQL/日志和带文件哈希的 `release.json`。不包含 `.env`、Git、node_modules或迁移快照。当前实际发布输入为32项校验资源，另加清单共33个文件，约7 MiB未压缩、1.8 MiB压缩；这不是线上I/O吞吐的实测值。
4. SCP上传构建包、校验文件、部署脚本和prepared管理标记。服务器只解压这组少量文件，不再git fetch/reset、不联网下载依赖、不执行包管理器或构建。
5. 校验提交SHA、Node版本及每个文件，执行有变化的迁移，在同一文件系统内用目录重命名切换dist，重启PM2后验证实际运行提交与首页。

## 前置要求

- 服务器 Node.js 22+、Bash、flock、nice、timeout、tar、sha256sum、curl、PM2。预检不会自行安装或升级软件。
- 应用与部署目录必须位于同一文件系统，否则停止，避免mv退化成跨盘复制。
- 原有 `.env`、签名私钥和 `/data/html` 保持原位置。首次配置只在部署锁内应用。
- 原有Git目录、node_modules、pnpm store均不会自动删除。即使仍占空间，新的运行包也不依赖它们；手工删除前还要确认旧版回退、其他项目或运维脚本是否需要。

## 运行与回退

PM2仍启动 `/opt/key-manager/dist/index.js`，工作目录仍是 `/opt/key-manager`。dist内部的package.json固定ESM类型，因此运行不依赖旧源码目录的package版本。整个dist包含配套注册表和迁移SQL，回退时一起恢复。

默认注册表优先级为：显式 `LICENSE_REGISTRY_PATH`、发布包 `dist/config/licenseSensorGroups.json`、旧源码工作目录config。设置了外部注册表路径时仍按该配置读取，不能假定CI会覆盖自定义文件。默认路径的注册表更新应重新构建发布包。

`GET /healthz` 返回 `{ok:true,commit:<运行构建SHA>}`，禁止缓存；标准本地开发构建的commit可以为空。这是进程/版本健康检查，不代表数据库、飞书或所有业务都正常。连续3次运行版本及首页检查失败，或重启失败时，脚本恢复previous-dist并重启；数据库迁移不自动回滚。

服务器Git HEAD不再代表发布版本，查看：

```bash
cd /opt/key-manager
node -e 'console.log(JSON.parse(require("fs").readFileSync("dist/release.json","utf8")).commit)'
curl -fsS http://127.0.0.1:3000/healthz
```

新包与SHA不匹配、缺文件、额外文件或校验失败，均在迁移和切换之前退出。

## 迁移复用

迁移器使用当前Drizzle MySQL迁移表及SQL断点规则；没有使用schema推送或重新生成迁移。SQL历史和数据库URL一起做不可逆哈希，只把摘要写入 `/opt/key-manager-deployments/migrations.sha256`，不写入连接URL或密码。成功才原子更新，失败不覆盖旧标记。

摘要相同时不连接数据库。SQL、数据库目标或连接配置变化时会重新检查；已记录迁移不会重复执行。数据库被恢复或重建后，即使URL未变也需强制检查：

```bash
cd /opt/key-manager
node dist/migrate.js /opt/key-manager-deployments/migrations.sha256 --force
```

生产迁移前仍需按原运维流程备份。迁移超时120秒，执行器Node堆上限192MiB，不等于整个进程的RSS硬限制。

## I/O 边界

- 解包、校验、迁移和历史清理使用nice 10；有ionice时使用best-effort优先级7，缺少时退回nice。调度器支持程度决定实际效果，不是磁盘带宽或IOPS硬限额。
- 不遍历node_modules、不执行全盘du/find、不自动prune依赖store、不删除业务日志或数据库。
- 历史清理仅退出时执行一次，维持最近2份成功、1份失败及当前任务。prepared超过24小时才可回收，未标记的旧人工目录仍保留。
- 上传中途被强杀、尚未落入标记的残留，以及其他服务/MySQL/系统日志的I/O，仍需单独观察；不能只凭磁盘空闲容量判断读写饱和。

## 验证

419项测试、类型检查、普通构建通过。独立临时目录没有node_modules，验证实际生产包启动、静态资源、版本健康检查、注册表及真实隔离MySQL登录；完整22份迁移执行、重复跳过、目标变更重查和失败不写标记均通过。部署Shell使用隔离命令桩验证正常切换、首次配置、迁移失败、重启失败、健康失败回退和错误SHA拒绝。没有用桩测试冒充真实服务器压力测试，降低幅度仍需部署后采样。
