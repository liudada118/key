import { randomBytes } from "node:crypto";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import path from "node:path";

export function parseProxyUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("INVALID_PROXY_URL"); }
  if (url.protocol !== "https:" || !url.username || !url.password || url.pathname !== "/" && url.pathname !== ""
    || url.search || url.hash) throw new Error("HTTPS_AUTHENTICATED_PROXY_REQUIRED");
  let username, password;
  try { username = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { throw new Error("INVALID_PROXY_CREDENTIAL_ENCODING"); }
  if (username.includes(":") || /[\r\n\x00]/.test(username + password)) throw new Error("INVALID_PROXY_CREDENTIALS");
  return { host: url.hostname, port: Number(url.port || 443), username, password };
}

/** A bounded TLS CONNECT probe. Never prints URLs, credentials, bodies, or headers. */
export function probeTunnel(proxyUrl, { target = "api.weixin.qq.com:443", authentication = "valid", method = "CONNECT",
  verifyWechatTls = false, timeoutMs = 12000, ca, connectHost } = {}) {
  const proxy = parseProxyUrl(proxyUrl);
  if (!/^[a-z0-9.-]+:[0-9]{1,5}$/.test(target) || !["CONNECT", "GET"].includes(method)
    || !["valid", "missing", "wrong"].includes(authentication)) throw new Error("INVALID_PROBE");
  if (verifyWechatTls && (target !== "api.weixin.qq.com:443" || method !== "CONNECT")) throw new Error("INVALID_TLS_TARGET");
  if (connectHost !== undefined && connectHost !== "127.0.0.1") throw new Error("INVALID_LOOPBACK_PROBE");
  return new Promise((resolve, reject) => {
    let header = Buffer.alloc(0), inner;
    const socket = tls.connect({ host: connectHost ?? proxy.host, port: proxy.port, servername: proxy.host, family: 4,
      minVersion: "TLSv1.2", rejectUnauthorized: true, ...(ca ? { ca } : {}) });
    const timer = setTimeout(() => finish(new Error("PROXY_TIMEOUT")), timeoutMs);
    let settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timer); inner?.destroy(); socket.destroy();
      if (error) reject(new Error("PROXY_CONNECTION_OR_TLS_FAILED")); else resolve(result);
    }
    socket.once("error", error => finish(error));
    socket.once("end", () => { if (!settled) finish(new Error("INCOMPLETE_PROXY_RESPONSE")); });
    socket.once("secureConnect", () => {
      const password = authentication === "wrong" ? randomBytes(32).toString("hex") : proxy.password;
      const authorization = authentication === "missing" ? "" : `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${password}`).toString("base64")}\r\n`;
      const requestTarget = method === "CONNECT" ? target : "http://api.weixin.qq.com/";
      socket.write(`${method} ${requestTarget} HTTP/1.1\r\nHost: ${target}\r\n${authorization}\r\n`);
    });
    function receive(chunk) {
      header = Buffer.concat([header, chunk]);
      const end = header.indexOf("\r\n\r\n");
      if (header.length > 8192) return finish(new Error("PROXY_HEADER_TOO_LARGE"));
      if (end < 0) return;
      const match = /^HTTP\/1\.[01] ([0-9]{3}) /.exec(header.toString("latin1"));
      if (!match) return finish(new Error("INVALID_PROXY_RESPONSE"));
      const status = Number(match[1]);
      socket.removeListener("data", receive);
      if (status !== 200 || !verifyWechatTls) return finish(null, { status, wechatTls: false });
      const remaining = header.subarray(end + 4);
      if (remaining.length) socket.unshift(remaining);
      inner = tls.connect({ socket, servername: "api.weixin.qq.com", minVersion: "TLSv1.2", rejectUnauthorized: true });
      inner.once("error", error => finish(error));
      inner.once("secureConnect", () => finish(null, { status, wechatTls: true }));
    }
    socket.on("data", receive);
  });
}

export async function checkProxy(proxyUrl, probe = probeTunnel) {
  const cases = [
    { name: "missing-auth", options: { authentication: "missing" }, expected: 407 },
    { name: "wrong-auth", options: { authentication: "wrong" }, expected: 407 },
    { name: "other-domain", options: { target: "example.com:443" }, expected: 403 },
    { name: "domain-suffix", options: { target: "api.weixin.qq.com.example.com:443" }, expected: 403 },
    { name: "literal-ip", options: { target: "1.1.1.1:443" }, expected: 403 },
    { name: "wrong-port", options: { target: "api.weixin.qq.com:80" }, expected: 403 },
    { name: "plain-http", options: { method: "GET" }, expected: 403 },
    { name: "wechat-tls", options: { verifyWechatTls: true }, expected: 200 },
  ];
  const results = [];
  for (const test of cases) {
    try {
      const result = await probe(proxyUrl, test.options);
      results.push({ name: test.name, ok: result.status === test.expected && (!test.options.verifyWechatTls || result.wechatTls === true), status: result.status });
    } catch {
      results.push({ name: test.name, ok: false, error: "CONNECTION_OR_TLS_FAILED" });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const proxyUrl = process.env.WECHAT_MP_PROXY_URL;
    parseProxyUrl(proxyUrl);
    const results = await checkProxy(proxyUrl);
    for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
    if (results.some(result => !result.ok)) process.exitCode = 1;
    console.log("No WeChat credentials or customer messages used. Whitelist and actual egress still require CRM verification.");
  } catch {
    console.error("Set a valid HTTPS WECHAT_MP_PROXY_URL in the protected process environment. Do not put credentials in CLI arguments.");
    process.exitCode = 1;
  }
}
