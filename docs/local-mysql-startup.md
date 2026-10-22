# Windows 本地 MySQL 启动

`ECONNREFUSED 127.0.0.1:3307` 表示该端口没有监听服务，不代表数据文件损坏。本机以前直接启动 `mysqld.exe`，未注册 Windows 服务，关机后临时进程不会自行恢复。

## 当前启动方式

- 当前用户登录 Windows 时，通过 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `KeyManagerLocalMySQL` 启动项运行 `scripts/start-local-mysql.ps1`，后台启动现有数据库，不显示交互窗口。
- `pnpm dev` 先执行 `scripts/ensure-local-mysql.mjs`。本机明确配置且数据库连接被拒绝时，先启动 MySQL并验证连接，再启动开发服务器。数据库已可连接时不重复启动。
- 这不是 Windows 系统服务：自动运行发生在用户登录后，Windows 也可能延迟执行登录启动项。系统启动后、尚未登录时不会启动；需要这种行为时应由管理员配置正式 MySQL 服务。
- 不重置密码、不初始化数据目录、不修改表结构、不自动执行迁移。只监听 `127.0.0.1`，不开放外网或 MySQL X 端口。

## 机器配置

本机配置为 Git 忽略的 `.local/mysql.json`，不含密码；账号连接继续使用已有 `.env` 中的 `DATABASE_URL`。

```json
{
  "schemaVersion": 1,
  "binaryPath": "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqld.exe",
  "baseDirectory": "C:\\Program Files\\MySQL\\MySQL Server 8.4",
  "dataDirectory": "E:\\key_mysql_data\\data",
  "port": 3307,
  "startupTimeoutSeconds": 45
}
```

启动脚本要求数据目录中的 `mysql.ibd`、`auto.cnf` 已存在。不得将 MariaDB 指向此 MySQL 数据目录；不得使用 `--initialize`、`--initialize-insecure` 或跳过权限校验的参数处理连接问题。

`ensure-local-mysql.mjs` 在非 Windows、未配置本地启动或数据库地址/端口不匹配时直接跳过；不会替远程数据库启动本地实例。密码错误、数据库不存在或超时不会触发重启；启动或连接验证失败会阻止本次 `pnpm dev` 继续执行，不输出连接凭据。

## 手动检查

```powershell
pnpm db:local:start
Get-NetTCPConnection -State Listen -LocalPort 3307
Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name KeyManagerLocalMySQL
```

启动日志位于数据目录的父目录：`E:\key_mysql_data\key-manager-start-*.err.log` 和对应的 `.out.log`。启动超时不强制杀死数据库进程，避免中断恢复。项目移动路径或更换 MySQL 安装目录后，需要更新配置及登录启动项。

仅在明确取消自动运行时删除本项目的启动项，不删除整个 Run 注册表键：

```powershell
Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name KeyManagerLocalMySQL
```

## 验证边界

已使用本机现有数据做正常关闭与自动启动测试，并核对账号、部门及密钥数量。未自动重启或注销 Windows，因此不把实际重启登录后的运行结果计为已验证。未更改线上服务器、Windows 全局执行策略或安装系统服务。

机制参考：[Windows Run 登录启动项](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)、[MySQL Windows 服务](https://dev.mysql.com/doc/refman/8.4/en/windows-start-service.html)。
