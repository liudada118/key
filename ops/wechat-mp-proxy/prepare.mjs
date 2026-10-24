import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = path.dirname(fileURLToPath(import.meta.url));
const fields = ["hostname", "tlsPort", "localPort", "squidBinary", "stunnelBinary", "authHelper"];

export function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)
    || Object.keys(config).length !== fields.length || fields.some(key => !(key in config))) throw new Error("INVALID_CONFIG_FIELDS");
  if (typeof config.hostname !== "string" || config.hostname.length > 253
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(config.hostname)) throw new Error("INVALID_HOSTNAME");
  for (const key of ["tlsPort", "localPort"]) {
    if (!Number.isInteger(config[key]) || config[key] < 1024 || config[key] > 65535) throw new Error("INVALID_PORT");
  }
  if (config.tlsPort === config.localPort) throw new Error("PORT_CONFLICT");
  for (const key of ["squidBinary", "stunnelBinary", "authHelper"]) {
    if (typeof config[key] !== "string" || !/^\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(config[key])) throw new Error("INVALID_EXECUTABLE_PATH");
  }
  if (path.posix.basename(config.squidBinary) !== "squid" || !/^stunnel(?:4)?$/.test(path.posix.basename(config.stunnelBinary))
    || path.posix.basename(config.authHelper) !== "basic_ncsa_auth") throw new Error("INVALID_EXECUTABLE_NAME");
  return { ...config };
}

function service(description, user, start, extra = "") {
  return `[Unit]
Description=${description}
Wants=network-online.target
After=network-online.target
${extra}
[Service]
Type=simple
User=${user}
Group=${user}
ExecStart=${start}
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_INET AF_UNIX
LimitNOFILE=256
TasksMax=64
MemoryMax=${user === "wechat-mp-squid" ? "192M" : "96M"}

[Install]
WantedBy=multi-user.target
`;
}

/** Separate system services: never include or override the host's main squid.conf. */
export function renderProxyFiles(input) {
  const config = validateConfig(input);
  return {
    "config.json": `${JSON.stringify(config, null, 2)}\n`,
    "squid.conf": `# Dedicated WeChat API CONNECT proxy; no include or general proxy rules.
visible_hostname wechat-mp-proxy
http_port 127.0.0.1:${config.localPort}
pid_filename none
cache_effective_user wechat-mp-squid
cache_effective_group wechat-mp-squid
auth_param basic program ${config.authHelper} /etc/wechat-mp-proxy/auth/passwd
auth_param basic realm WeChat-MP-Proxy
auth_param basic children 2 startup=1 idle=1
auth_param basic credentialsttl 1 minute
acl local_tls src 127.0.0.1/32
acl only_connect method CONNECT
acl only_tls_port port 443
acl wechat_api dstdomain -n api.weixin.qq.com
acl authenticated proxy_auth REQUIRED
acl too_many_connections maxconn 32
http_access deny !local_tls
http_access deny !only_connect
http_access deny !only_tls_port
http_access deny !wechat_api
http_access deny too_many_connections
http_access allow only_connect wechat_api authenticated
http_access deny all
cache deny all
cache_mem 8 MB
maximum_object_size 0 KB
access_log none
cache_store_log none
cache_log /dev/null
debug_options ALL,0
icp_port 0
htcp_port 0
pinger_enable off
netdb_filename none
connect_timeout 5 seconds
request_timeout 10 seconds
read_timeout 60 seconds
client_lifetime 5 minutes
shutdown_lifetime 2 seconds
`,
    "stunnel.conf": `foreground = yes
syslog = no
debug = warning
pid =

[wechat-mp-proxy]
client = no
accept = 0.0.0.0:${config.tlsPort}
connect = 127.0.0.1:${config.localPort}
cert = /etc/wechat-mp-proxy/tls/fullchain.pem
key = /etc/wechat-mp-proxy/tls/privkey.pem
sslVersionMin = TLSv1.2
TIMEOUTconnect = 5
TIMEOUTidle = 60
`,
    "wechat-mp-squid.service": service("WeChat MP restricted CONNECT proxy", "wechat-mp-squid", `${config.squidBinary} -N -f /etc/wechat-mp-proxy/squid.conf`),
    "wechat-mp-tls.service": service("WeChat MP TLS proxy entrance", "wechat-mp-tls", `${config.stunnelBinary} /etc/wechat-mp-proxy/stunnel.conf`, "Requires=wechat-mp-squid.service\nAfter=wechat-mp-squid.service\n"),
  };
}

export function prepareProxy(configPath, outputDirectory) {
  const files = renderProxyFiles(JSON.parse(readFileSync(configPath, "utf8")));
  const output = path.resolve(outputDirectory);
  if (existsSync(output)) throw new Error("OUTPUT_ALREADY_EXISTS");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(output, name), body, { mode: 0o600, flag: "wx" });
  for (const name of ["install.sh", "check.mjs", "README.md"]) {
    writeFileSync(path.join(output, name), readFileSync(path.join(source, name)), { mode: name === "install.sh" ? 0o700 : 0o600, flag: "wx" });
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [config, output, ...rest] = process.argv.slice(2);
    if (!config || !output || rest.length) throw new Error("USAGE: node prepare.mjs CONFIG_JSON NEW_OUTPUT_DIRECTORY");
    console.log(`Prepared: ${prepareProxy(config, output)}. Not installed or started.`);
  } catch (error) {
    console.error(error.message.startsWith("USAGE:") ? error.message : "Proxy preparation failed; check public configuration and output directory.");
    process.exitCode = 1;
  }
}
