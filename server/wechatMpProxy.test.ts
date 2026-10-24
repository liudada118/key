import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import tls, { type TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prepareProxy, renderProxyFiles, validateConfig } from "../ops/wechat-mp-proxy/prepare.mjs";
import { checkProxy, parseProxyUrl, probeTunnel } from "../ops/wechat-mp-proxy/check.mjs";

const project = path.resolve(import.meta.dirname, "..");
const source = path.join(project, "ops/wechat-mp-proxy");
const config = JSON.parse(readFileSync(path.join(source, "config.example.json"), "utf8"));
const roots: string[] = [];
function temporary() { const root = mkdtempSync(path.join(tmpdir(), "key-wechat-proxy-")); roots.push(root); return root; }
function cleanup(root: string) {
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("key-wechat-proxy-")) throw new Error("UNSAFE_FIXTURE_PATH");
  rmSync(root, { recursive: true, force: true });
}
afterEach(() => { for (const root of roots.splice(0)) cleanup(root); });

describe("dedicated WeChat proxy configuration", () => {
  it("only allows authenticated exact-host TLS CONNECT after all deny rules", () => {
    const file = renderProxyFiles(config)["squid.conf"];
    expect(file).toContain("http_port 127.0.0.1:3128");
    expect(file).toContain("acl wechat_api dstdomain -n api.weixin.qq.com");
    expect(file.match(/^http_access .*$/gm)).toEqual([
      "http_access deny !local_tls", "http_access deny !only_connect", "http_access deny !only_tls_port",
      "http_access deny !wechat_api", "http_access deny too_many_connections",
      "http_access allow only_connect wechat_api authenticated", "http_access deny all",
    ]);
    expect(file).toContain("acl only_tls_port port 443");
    expect(file).not.toMatch(/^(?:include|ssl_bump|cache_dir|cache_peer) /m);
    expect(file).toContain("cache deny all"); expect(file).toContain("access_log none");
  });
  it("separates TLS secrets from password hashes and bounds the independent services", () => {
    const files = renderProxyFiles(config), tlsConfig = files["stunnel.conf"];
    expect(tlsConfig).toContain("accept = 0.0.0.0:18443");
    expect(tlsConfig).toContain("connect = 127.0.0.1:3128");
    expect(tlsConfig).toContain("sslVersionMin = TLSv1.2");
    expect(files["wechat-mp-squid.service"]).toContain("User=wechat-mp-squid");
    expect(files["wechat-mp-tls.service"]).toContain("User=wechat-mp-tls");
    for (const name of ["wechat-mp-squid.service", "wechat-mp-tls.service"]) {
      expect(files[name]).toContain("RestrictAddressFamilies=AF_INET AF_UNIX");
      expect(files[name]).toContain("NoNewPrivileges=true"); expect(files[name]).toContain("LimitNOFILE=256");
      expect(files[name]).not.toContain("/opt/key-manager");
    }
  });
  it.each([
    { tlsPort: 443 }, { localPort: 65536 }, { tlsPort: 3128 }, { tlsPort: "18443" },
    { hostname: "shroom.jq-industries.com\ninclude attacker" }, { hostname: "127.0.0.1" },
    { squidBinary: "/usr/sbin/squid --open" }, { authHelper: "/usr/lib/../evil/basic_ncsa_auth" },
    { stunnelBinary: "/usr/bin/stunnel\nExecStart=evil" }, { password: "not-accepted" },
  ])("rejects invalid/injected public configuration (%#)", value => {
    expect(() => validateConfig({ ...config, ...value })).toThrow();
  });
  it("supports an explicitly chosen free port and package paths without adding targets", () => {
    const files = renderProxyFiles({ ...config, tlsPort: 19443, localPort: 33128, stunnelBinary: "/usr/bin/stunnel4", authHelper: "/usr/lib/squid/basic_ncsa_auth" });
    expect(files["squid.conf"]).toContain("http_port 127.0.0.1:33128");
    expect(files["stunnel.conf"]).toContain("accept = 0.0.0.0:19443");
    expect(files["wechat-mp-tls.service"]).toContain("ExecStart=/usr/bin/stunnel4 ");
  });
  it("creates a standalone bundle with no credentials and refuses existing output", () => {
    const root = temporary(), input = path.join(root, "public.json"), output = path.join(root, "ready");
    writeFileSync(input, JSON.stringify(config));
    expect(prepareProxy(input, output)).toBe(output);
    expect(readdirSync(output).sort()).toEqual(["README.md", "check.mjs", "config.json", "install.sh", "squid.conf", "stunnel.conf", "wechat-mp-squid.service", "wechat-mp-tls.service"].sort());
    expect(() => prepareProxy(input, output)).toThrow("OUTPUT_ALREADY_EXISTS");
    expect(readFileSync(path.join(output, "config.json"), "utf8")).not.toMatch(/password|secret/i);
  });
  it("does not create output for invalid input", () => {
    const root = temporary(), input = path.join(root, "public.json"), output = path.join(root, "ready");
    writeFileSync(input, JSON.stringify({ ...config, localPort: 80 }));
    expect(() => prepareProxy(input, output)).toThrow(); expect(existsSync(output)).toBe(false);
  });
  it("checks certificate, occupancy, dedicated ownership, config syntax, and avoids unrelated services", () => {
    const script = readFileSync(path.join(source, "install.sh"), "utf8");
    expect(script.indexOf("-verify_hostname")).toBeLessThan(script.indexOf("useradd --system"));
    expect(script).toContain('ss -H -ltn "sport = :$port"');
    expect(script).toContain("htpasswd -i -c -B -C 10"); expect(script).not.toContain("htpasswd -b");
    expect(script).toContain('randomBytes(32).toString("base64url")');
    expect(script).toContain("chmod 600 /etc/wechat-mp-proxy/crm.env");
    expect(script).toContain('runuser -u wechat-mp-squid -- "$SQUID" -k parse');
    expect(script).toContain("systemd-analyze verify");
    expect(script).not.toMatch(/(?:systemctl|pm2) (?:restart|stop|disable) (?:squid|stunnel|nginx|key-manager)(?:\s|\.)/);
    const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
    if (existsSync(bash)) expect(spawnSync(bash, ["-n", path.join(source, "install.sh")], { windowsHide: true }).status).toBe(0);
  });
});

describe("safe proxy acceptance probes", () => {
  const url = "https://mp_crm:test-only%3A%40%25@localhost:18443";
  it("decodes reserved characters for Basic auth without changing the password", () => {
    expect(parseProxyUrl(url)).toMatchObject({ host: "localhost", port: 18443, username: "mp_crm", password: "test-only:@%" });
  });
  it.each([undefined, "http://user:password@localhost:3128", "https://localhost:18443", "https://user:password@localhost/relay",
    "https://user:password@localhost/?token=bad", "https://user%3Aother:password@localhost/", "https://user:%0A@localhost/"])("rejects insecure or incompatible proxy settings (%#)", value => {
    expect(() => parseProxyUrl(value)).toThrow();
  });
  it("requires negative ACL cases and authenticated inner WeChat TLS before passing", async () => {
    const probe = vi.fn(async (_url, options) => ({ status: options.authentication ? 407 : options.verifyWechatTls ? 200 : 403, wechatTls: !!options.verifyWechatTls }));
    const results = await checkProxy(url, probe);
    expect(results).toHaveLength(8); expect(results.every(item => item.ok)).toBe(true);
    expect(probe.mock.calls.some(([, options]) => options.target === "1.1.1.1:443")).toBe(true);
  });
  it("does not mistake an open proxy or a failed TLS handshake for successful acceptance", async () => {
    const results = await checkProxy(url, async () => ({ status: 200, wechatTls: false }));
    expect(results.every(item => !item.ok)).toBe(true);
  });
  it("sanitizes connection failures without exposing a proxy URL or upstream response", async () => {
    const results = await checkProxy(url, async () => { throw new Error(`private failure ${url}`); });
    expect(results.every(item => !item.ok)).toBe(true);
    expect(JSON.stringify(results)).not.toContain("test-only"); expect(JSON.stringify(results)).not.toContain("https://");
  });
});

const openssl = process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
const hasOpenssl = spawnSync(openssl, ["version"], { windowsHide: true }).status === 0;
describe.skipIf(!hasOpenssl)("real loopback TLS proxy probe (not a Squid/production test)", () => {
  let root: string, certificate: Buffer, key: Buffer;
  const servers: tls.Server[] = [], sockets = new Set<TLSSocket>();
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "key-wechat-proxy-"));
    execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost", "-keyout", path.join(root, "key.pem"), "-out", path.join(root, "cert.pem")], { stdio: "ignore", windowsHide: true });
    certificate = readFileSync(path.join(root, "cert.pem")); key = readFileSync(path.join(root, "key.pem"));
  });
  afterEach(async () => {
    for (const socket of sockets) socket.destroy(); sockets.clear();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  });
  afterAll(() => { if (root) cleanup(root); });
  async function listener(reply: (request: string) => string | null) {
    const server = tls.createServer({ cert: certificate, key }, socket => {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
      let request = "";
      socket.on("data", chunk => {
        request += chunk.toString("latin1");
        if (!request.endsWith("\r\n\r\n")) return;
        const response = reply(request); if (response) socket.write(response);
      });
    });
    server.on("tlsClientError", () => {});
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server);
    return `https://test:fake-only@localhost:${(server.address() as { port: number }).port}`;
  }
  it("performs real TLS and sends CONNECT with authentication, returning only status", async () => {
    let seen = "";
    const url = await listener(request => { seen = request; return "HTTP/1.1 200 Connection established\r\n\r\n"; });
    expect(await probeTunnel(url, { ca: certificate })).toEqual({ status: 200, wechatTls: false });
    expect(seen).toContain("CONNECT api.weixin.qq.com:443 HTTP/1.1\r\n");
    expect(seen).toContain(`Proxy-Authorization: Basic ${Buffer.from("test:fake-only").toString("base64")}`);
  });
  it("can diagnose a relay on loopback while still verifying its DNS certificate identity", async () => {
    const url = await listener(() => "HTTP/1.1 200 Connection established\r\n\r\n");
    expect(await probeTunnel(url, { ca: certificate, connectHost: "127.0.0.1" })).toEqual({ status: 200, wechatTls: false });
    expect(() => probeTunnel(url, { connectHost: "other.example.com" })).toThrow("INVALID_LOOPBACK_PROBE");
  });
  it("can omit auth to verify the proxy challenge", async () => {
    let seen = "";
    const url = await listener(request => { seen = request; return "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"; });
    expect(await probeTunnel(url, { authentication: "missing", ca: certificate })).toEqual({ status: 407, wechatTls: false });
    expect(seen).not.toContain("Proxy-Authorization:");
  });
  it("does not trust an unrecognized proxy certificate", async () => {
    const url = await listener(() => "HTTP/1.1 200 Connection established\r\n\r\n");
    await expect(probeTunnel(url)).rejects.toThrow("PROXY_CONNECTION_OR_TLS_FAILED");
  });
  it.each(["not-http\r\n\r\n", "HTTP/1.1 200 OK\r\nX-Padding: " + "x".repeat(9000) + "\r\n\r\n"])("rejects malformed and oversized proxy headers (%#)", async response => {
    const url = await listener(() => response);
    await expect(probeTunnel(url, { ca: certificate })).rejects.toThrow("PROXY_CONNECTION_OR_TLS_FAILED");
  });
  it("times out a silent connection instead of hanging", async () => {
    const url = await listener(() => null);
    await expect(probeTunnel(url, { ca: certificate, timeoutMs: 100 })).rejects.toThrow("PROXY_CONNECTION_OR_TLS_FAILED");
  });
});
