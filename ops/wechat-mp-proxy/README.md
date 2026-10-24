# 公众号固定出口部署包

目标入口：`https://shroom.jq-industries.com:18443`。本包提供带认证的 HTTPS CONNECT 代理，不是网页或 JSON API；只有 CRM 服务端使用它。只允许连接 `api.weixin.qq.com:443`，不接收公众号回调、不迁移 CRM 或数据库。

当前状态（2026-10-23）：已在 `39.105.83.246` 安装并启动两个独立服务、配置开机自启；主机防火墙持久放行 `18443/tcp`。用户确认放行云安全组后，外网 8 项认证/目标白名单/双层 TLS 验收全部通过，公网 `3128` 连接超时。CRM 现可按受保护配置接入代理，但公众号白名单及正式 CRM 联调未执行，不能宣称公众号业务已恢复。云平台实例元数据报告 EIP 为 `39.105.83.246`，公网回显探测未成功，不能当作微信实际出网已核实。下文保留部署过程中的历史验证边界，以本段及末尾复测记录为当前状态。

## 1. 服务器准备

在服务器终端操作，不要把服务器密码、公众号密钥、代理密码或证书私钥发到聊天中。先检查：

```bash
cat /etc/os-release
ss -ltnp
systemctl --version
command -v node openssl squid stunnel stunnel4 htpasswd
```

需要：Node.js 22+、受发行版安全维护的 Squid 4～7、stunnel 5（支持 TLSv1.2 下限）、OpenSSL（支持 `verify -verify_hostname`）、systemd 239+、`runuser` 和 `htpasswd`。不支持 Squid 8 配置格式，也不自动升级旧系统。检查系统版本后选一种安装方式，不运行全系统升级：

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install squid stunnel4 apache2-utils

# RHEL / Alibaba Cloud Linux / Rocky：先确认对应软件源和系统版本
sudo dnf install squid stunnel httpd-tools
```

安装发行版软件包可能按发行版策略启动默认服务，须先记录原有服务状态，并检查监听；不要覆盖已有 `/etc/squid/squid.conf`，不要停其他项目正在用的 Squid。若新安装的默认 Squid 额外监听公网 3128，应在确认未被其他项目使用后停用那个默认实例，本包使用独立实例。安装包本身不等于已经安全上线。

核对二进制和认证助手实际路径：Debian 常见 `/usr/lib/squid/basic_ncsa_auth`；RPM 系常见 `/usr/lib64/squid/basic_ncsa_auth`。按实际结果修改 `config.example.json` 的公开参数，不填写密码。可用 `dpkg -L squid` 或 `rpm -ql squid` 查看。`18443`、`3128` 被占用则另选未占用端口并重新生成，不能停止现有网站抢占端口。

## 2. 生成并首次安装

将整个 `ops/wechat-mp-proxy` 目录上传到服务器，例如 `/root/wechat-mp-proxy-source`，无需上传项目依赖、数据库或 `.env`。在源码目录执行：

```bash
cd /root/wechat-mp-proxy-source
node prepare.mjs config.example.json /root/wechat-mp-proxy-ready
```

生成器拒绝覆盖已有输出目录。审阅生成的 `squid.conf`、`stunnel.conf` 和两个 `.service` 文件；不会自动安装、申请证书、启动服务或调整网络。

找到现网站正在使用、覆盖 `shroom.jq-industries.com` 的受信任证书链和私钥。不要假定证书一定在 `/etc/letsencrypt`；宝塔等面板可能放在其他目录。然后执行以下命令，把两个路径替换成服务器现有真实路径：

```bash
cd /root/wechat-mp-proxy-ready
sudo bash install.sh /实际证书路径/fullchain.pem /实际证书路径/privkey.pem
```

安装器先检查端口、证书域名和受信任证书链、剩余有效期（至少 7 天）及公私钥匹配，再创建自己的两个系统账号，自动生成独立 `mp_crm` 的 256 位随机代理密码，校验 Squid 和 systemd 并启动。密码用 BCrypt（cost 10）哈希保存在 `root:wechat-mp-squid /etc/wechat-mp-proxy/auth/passwd`，通过标准输入交给认证工具，不进入命令参数、日志或仓库。

安装器按 Squid `-v` 的 ICMP 构建开关跳过不支持的 `pinger_enable`/`netdb_filename` 两行，避免无 ICMP 的 RPM 包解析时产生非致命 ERROR。其余访问策略不放宽，不因不支持可选探测功能关闭认证。

完整 CRM 环境配置保存在服务器 **仅 root 可读的 `/etc/wechat-mp-proxy/crm.env`（0600）**。该文件包含代理明文凭据，只通过受控密钥渠道转移到 CRM 服务端，不能粘贴到聊天、截图、Git 或诊断输出。随机密码使用 URL 安全字符，可直接用于生成的 URL；它不是公众号 AppSecret。软件安装失败也不要公开该文件。

TLS 使用另一个低权限账号 `wechat-mp-tls`，只可读取专用证书副本；Squid 账号不能读取 TLS 私钥。网站原证书权限不变。若证书失败，不能关闭证书校验规避问题。

文件仅安装到 `/etc/wechat-mp-proxy/` 及两个专用 systemd 单元，不修改 Nginx、PM2、网站 `.env`、已有 Squid/stunnel 单元、公众号配置或防火墙。已有同名安装、账号、组或单元会中止。安装中途失败可能留下专用文件或账号，不会自动删除：先按报错检查再人工处理，不要反复覆盖重装。

检查结果：

```bash
systemctl status wechat-mp-squid wechat-mp-tls --no-pager
ss -ltnp
journalctl -u wechat-mp-squid -u wechat-mp-tls -n 40 --no-pager
```

Squid 必须只监听 `127.0.0.1:3128`（或选定本地端口），TLS 监听 `0.0.0.0:18443`。两服务限制 IPv4/Unix socket，不引入 IPv6 微信出口；不要把公网/NAT IP 硬绑定到不存在的本地网卡。确认系统沙箱和当前 Squid 组合实际能解析并连接微信后再验收。`MemoryMax` 为 192/96 MiB，并发 CONNECT 上限 32（所有连接由本机 stunnel 转发，因此是本实例聚合上限）；这是保护小内存服务器的起始值，不是性能保证，须结合实际观测调整。

公网安全组/主机防火墙只增加 TCP `18443`，不开放 `3128`，不清空其他规则，不触碰 22/20202、80/443 或现有应用端口。CRM 出口会变化时，不要只放行某个临时 CRM IP。默认不做请求访问日志，不写 URL、token、认证头或消息正文，也不使用磁盘响应缓存；journal 仍可能记录少量运维错误，请按现有系统日志保留策略管理。

## 3. 配置 CRM 并验收

在正式 CRM 的受保护服务端环境设置独立变量：

```text
WECHAT_MP_PROXY_URL=https://mp_crm:URL百分号编码后的代理密码@shroom.jq-industries.com:18443
```

用户名、密码保留字符分别使用 `encodeURIComponent` 编码，不能手动删改密码字符。上面不是可直接使用的真实凭据。不要把完整 URL 输出到日志、截图、代码或命令参数；不用全局 `HTTP_PROXY`/`HTTPS_PROXY`，不替换企业微信的 `WECHAT_PROXY_URL`。

本仓库不是 CRM，不包含文档提到的 `server/mpHttp.ts`，因此本次不修改该客户端。由 CRM 管理员确认它的 `HttpsProxyAgent`、禁止跟随重定向、12 秒超时、认证失败不回退直连等原有约束确实存在；未获客户端代码和正式凭据，不能把这些行为计为本包已验证。

在同样受保护环境中运行（工具只读取环境变量，输出测试名称和 PASS/FAIL，不输出凭据）：

```bash
node check.mjs
```

依次验证：无认证 407、错密码 407、其他域名/伪造后缀/IP 目标/80 端口/普通 HTTP 均 403，正确认证的微信 CONNECT 为 200 且内部微信证书验证成功。任何拒绝测试失败都应停止上线。探测不需要 AppID/AppSecret、不获取 token、不发送任何客户消息，也不验证公众号白名单。

还必须从服务器外部检查公网 3128 不可连接。服务器自身检查回环监听、配置单测或仅一次 CONNECT 成功不能代替这项验收。用现有监控核对 18443 的 TLS 证书链和域名，不允许 `--proxy-insecure`、`rejectUnauthorized:false`、`NODE_TLS_REJECT_UNAUTHORIZED=0`。

管理员先确认云平台固定公网/NAT 出口，再通过受控回显服务核对实际出网 IPv4，在公众号 API IP 白名单中添加该纯 IP。保留其他仍使用的白名单条目；不要把入口 IP 直接视为出口已验证。代理只允许微信，不要为查 IP 扩大目标白名单。

正式 CRM 重启生效后强制刷新 token，再调用用户资料 API，确认不再 40164 且流量经过代理。客服回复只在已确认测试会话中另行联调，不自动给真实客户发消息。在维护窗口验证代理故障/错误认证时 CRM 报错、不改回直连。最后验收服务及服务器重启后的行为；不改公众号接收 URL、Token 或 EncodingAESKey。

## 4. 续期、轮换与回退

本包复制证书，**不会随网站证书自动续期**。把下面操作纳入现有证书成功续期 hook，替换成真实来源，先验证 hook；否则网站证书虽然更新，中转仍会过期：

```bash
install -o root -g root -m 644 /实际新证书路径/fullchain.pem /etc/wechat-mp-proxy/tls/fullchain.pem
install -o root -g wechat-mp-tls -m 640 /实际新证书路径/privkey.pem /etc/wechat-mp-proxy/tls/privkey.pem
systemctl restart wechat-mp-tls.service
```

复制前仍应检查证书有效期、公私钥匹配，留受保护备份；两个文件都更新成功后才重启。新连接需重新验收 TLS。服务升级或改配置也需要受保护备份、Squid `-k parse`、`systemd-analyze verify` 后仅重启这两个专用服务，不覆盖现网站。轮换密码使用 `htpasswd -B /etc/wechat-mp-proxy/auth/passwd mp_crm`，同步更新 CRM 并验证；认证缓存最多 1 分钟，既有隧道不会瞬间撤销，急需撤销时重启专用代理。

停用只操作专用实例：

```bash
systemctl disable --now wechat-mp-tls.service wechat-mp-squid.service
```

不会卸载依赖或删除账号、文件、证书、数据库。CRM 不应自动清空代理变量回退动态直连。必须在管理员确认其他白名单出口可用时，才按 CRM 原流程另行切换。本包独立安装，现有 key-manager CI 不会安装、更新或卸载该服务；更新本仓网页也不会创建这个中转。

参考：[Squid ACL](https://www.squid-cache.org/Doc/config/acl/)、[Squid 认证](https://www.squid-cache.org/Doc/config/auth_param/)、[stunnel 配置手册](https://www.stunnel.org/manual.html)。

## 本次验证记录（2026-10-23）

33 项专项测试通过：公开参数校验/防注入、生成不覆盖、ACL 顺序和低权限配置、探测的错误脱敏和负向用例编排，以及临时本机证书下的真实 TLS CONNECT、无认证、拒绝不受信任证书、坏响应和超时。全套 569 项通过、52 项环境集成跳过；类型检查、生产构建和 Bash 语法通过。

没有在 Linux 上运行实际 Squid/stunnel，没有取得服务器 SSH 授权，也未做真实 CRM、微信白名单、证书续期或服务器重启验收。单测中的 TLS 对端是隔离测试服务，不是生产代理或微信；不能据此宣称代理已经上线。

## 后续实际部署记录（2026-10-23）

在用户提供本机 SSH 私钥路径后完成部署。Alibaba Cloud Linux 4.0.3，systemd 255、Node 22.22.0、Squid 7.2、stunnel 5.75；包管理器仅新增 15 个软件包，未升级其他应用。原有默认 Squid/stunnel 服务未启动，专用服务均 active/enabled。现有 Nginx、PM2、网站和数据库未改动，密钥网站 `/healthz` 仍返回原 `c350e349afd6ff09a08f4b181b17c928c23bf4a9`。

证书来源 `/etc/nginx/ssl/jq-industries.com.pem` 与 `.key`，已验证受信任证书链、域名和公私钥匹配，到期时间 `2027-01-13 23:59:59 UTC`。仅复制到专用路径，未改原证书或其权限；自动续期同步尚未接入，换证时按本文件维护步骤更新代理副本。

服务器本机实际 Squid/stunnel 测试：无/错认证 407、其他域名/伪造后缀/IP 目标/80 端口/普通 HTTP 403、合法认证后微信内部 TLS 200，8 项通过；两个服务重启后复测仍全部通过。回环探测保留证书域名和信任校验，不使用 `rejectUnauthorized:false`。34 项本地专项及全套 570 项通过，52 项环境集成跳过，类型检查和构建通过。未重启服务器，也未使用公众号秘密或给客户发送消息。

公网 `18443` 和 `3128` 从工作站连接均超时；主机 firewalld 仅新增 18443，且没有额外 iptables 拒绝规则。下一步须由云账号管理员在阿里云 ECS 安全组入方向允许 TCP 18443。3128 继续仅回环监听、不开放。没有云账号权限，未代为操作安全组；外部连接成功前不要把 CRM 切到该代理。实际微信白名单来源与 CRM 强刷 token/用户资料、失败不回退、续期及重启仍待验收。

本轮生成的正式代理配置保存在服务器 `/etc/wechat-mp-proxy/crm.env`，并通过 SSH 安全传输到本机当前用户专有权限的 `.local/wechat-mp-secrets/crm.env`。两处均含真实代理密码，不能提交、打印或通过普通聊天传递。临时 SSH 副本仅用于本次部署；原私钥不改动、不上传到服务器或仓库。

## 安全组放行后的公网复测（2026-10-23）

用户确认放行 TCP 18443 后，从本机工作站经公网正式域名完成实际请求，8 项全部通过：无认证407、错密码407、其他域名403、伪造后缀403、IP目标403、80端口403、普通HTTP403、正确认证建立微信隧道200并成功验证内部微信TLS证书。代理外层证书同样保持信任链与域名校验。公网IP的3128端口超时不可达，与仅回环监听相符。

公网阻断已解除；后续由 CRM 管理员安全导入 `crm.env` 中的 `WECHAT_MP_PROXY_URL` 并按原发布方式重启，核对公众号 API IP 白名单，强制刷新 token、查询用户资料，并在受控会话验证客服回复及失败不直连。上述业务操作本轮未执行，未获取公众号秘密或发送客户消息。本轮仅复测及更新文档，无运行代码修改，不重复执行全套单测或生产构建。
