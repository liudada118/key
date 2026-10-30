import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const approval = vi.hoisted(() => ({ reviewKeyGenerationRequest: vi.fn(), getActiveSuperAdmin: vi.fn() }));
vi.mock("./keyGenerationRequestApproval", () => ({ reviewKeyGenerationRequest: approval.reviewKeyGenerationRequest }));
vi.mock("./db", () => ({ getActiveSuperAdmin: approval.getActiveSuperAdmin }));
import { calculateFeishuCallbackSignature, FEISHU_KEY_REQUEST_CALLBACK_PATH, registerFeishuKeyRequestCardCallback } from "./feishuKeyRequestCardCallback";

const token = "synthetic-verification-token", encryptKey = "synthetic-encrypt-key";
let server: Server | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("FEISHU_APP_ID", "");
  vi.stubEnv("FEISHU_APPROVAL_CHAT_ID", "");
  vi.stubEnv("FEISHU_VERIFICATION_TOKEN", token);
  vi.stubEnv("FEISHU_CALLBACK_ENCRYPT_KEY", "");
});
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => {
    server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections();
  });
  server = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function send(payload: unknown, headers: Record<string, string> = {}) {
  if (!server) {
    const app = express();
    registerFeishuKeyRequestCardCallback(app);
    app.use(express.json({ limit: "50mb" }));
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  }
  const port = (server.address() as { port: number }).port;
  return fetch(`http://127.0.0.1:${port}${FEISHU_KEY_REQUEST_CALLBACK_PATH}`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(payload),
  });
}
function encrypted(payload: unknown) {
  const iv = Buffer.alloc(16, 7), key = crypto.createHash("sha256").update(encryptKey).digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return { encrypt: Buffer.concat([iv, cipher.update(JSON.stringify(payload)), cipher.final()]).toString("base64") };
}

describe("Feishu URL verification bootstrap", () => {
  it.each([false, true])("echoes only the verified challenge without an approval group or database access (encrypted %s)", async encrypt => {
    if (encrypt) vi.stubEnv("FEISHU_CALLBACK_ENCRYPT_KEY", encryptKey);
    const payload = { type: "url_verification", token, challenge: "synthetic-challenge" };
    const response = await send(encrypt ? encrypted(payload) : payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "synthetic-challenge" });
    expect(approval.getActiveSuperAdmin).not.toHaveBeenCalled();
    expect(approval.reviewKeyGenerationRequest).not.toHaveBeenCalled();
  });

  it("fails closed with an actionable configuration error when verification token is missing", async () => {
    vi.stubEnv("FEISHU_VERIFICATION_TOKEN", "");
    const response = await send({ type: "url_verification", token, challenge: "secret-challenge" });
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("FEISHU_VERIFICATION_TOKEN");
    expect(body).not.toContain("secret-challenge");
  });

  it("rejects an incorrect token even during setup", async () => {
    const response = await send({ type: "url_verification", token: "wrong", challenge: "secret-challenge" });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("secret-challenge");
    expect(console.warn).toHaveBeenCalledWith("[Feishu] 密钥审批回调被拒绝", {
      status: 401, reason: "飞书回调 Verification Token 无效",
    });
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("secret-challenge");
  });

  it("reports missing or incorrect encryption keys without exposing the payload", async () => {
    const payload = encrypted({ type: "url_verification", token, challenge: "secret-challenge" });
    expect((await send(payload)).status).toBe(503);
    vi.stubEnv("FEISHU_CALLBACK_ENCRYPT_KEY", "wrong-encryption-key");
    const response = await send(payload);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("secret-challenge");
  });

  it.each([undefined, "", 42, "x".repeat(1025)])("rejects an invalid URL-verification challenge (%#)", async challenge => {
    expect((await send({ type: "url_verification", token, challenge })).status).toBe(400);
  });

  it("does not let an arbitrary challenge field bypass signatures on actual card actions", async () => {
    vi.stubEnv("FEISHU_CALLBACK_ENCRYPT_KEY", encryptKey);
    const response = await send({ challenge: "not-url-verification", header: { token, event_type: "card.action.trigger" } });
    expect(response.status).toBe(401);
    expect(approval.reviewKeyGenerationRequest).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith("[Feishu] 密钥审批回调被拒绝", {
      status: 401, reason: "飞书回调缺少签名请求头",
    });
  });

  it("distinguishes a bad signature without logging the signature, key or callback body", async () => {
    vi.stubEnv("FEISHU_CALLBACK_ENCRYPT_KEY", encryptKey);
    const response = await send({ header: { token, event_type: "card.action.trigger" }, privateField: "private-callback-body" }, {
      "X-Lark-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
      "X-Lark-Request-Nonce": "private-nonce",
      "X-Lark-Signature": "private-signature",
    });
    expect(response.status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith("[Feishu] 密钥审批回调被拒绝", {
      status: 401, reason: "飞书回调签名无效",
    });
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    for (const secret of [token, encryptKey, "private-nonce", "private-signature", "private-callback-body"]) {
      expect(logs).not.toContain(secret);
    }
    expect(approval.getActiveSuperAdmin).not.toHaveBeenCalled();
    expect(approval.reviewKeyGenerationRequest).not.toHaveBeenCalled();
  });

  it("distinguishes expired callback timestamps before reaching approval", async () => {
    vi.stubEnv("FEISHU_CALLBACK_ENCRYPT_KEY", encryptKey);
    const payload = { header: { token, event_type: "card.action.trigger" } };
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    const response = await send(payload, {
      "X-Lark-Request-Timestamp": timestamp,
      "X-Lark-Request-Nonce": "private-nonce",
      "X-Lark-Signature": calculateFeishuCallbackSignature({ timestamp, nonce: "private-nonce", encryptKey, rawBody: JSON.stringify(payload) }),
    });
    expect(response.status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith("[Feishu] 密钥审批回调被拒绝", expect.objectContaining({
      status: 401, reason: "飞书回调时间戳已过期",
      timestampUnit: "seconds",
    }));
    expect(approval.reviewKeyGenerationRequest).not.toHaveBeenCalled();
  });

  it.each(["seconds", "milliseconds", "microseconds", "nanoseconds", "decimal", "scientific", "go_time_utc", "go_time_cst"])("accepts a correctly signed encrypted card action using %s with a mocked approval", async unit => {
    vi.stubEnv("FEISHU_APP_ID", "cli_synthetic_app");
    vi.stubEnv("FEISHU_APPROVAL_CHAT_ID", "oc_synthetic_approval");
    vi.stubEnv("FEISHU_CALLBACK_ENCRYPT_KEY", encryptKey);
    approval.getActiveSuperAdmin.mockResolvedValueOnce({ id: 1, username: "synthetic-admin", name: "Synthetic admin" });
    approval.reviewKeyGenerationRequest.mockResolvedValueOnce({ generatedKeyCount: 1 });
    const envelope = encrypted({ schema: "2.0", header: { token, app_id: "cli_synthetic_app", event_type: "card.action.trigger" }, event: {
      operator: { open_id: "ou_synthetic_approver" }, context: { open_chat_id: "oc_synthetic_approval" },
      action: { value: { source: "key_manager", action: "APPROVE", request_id: 42, request_no: "KGR-SYNTHETIC" } },
    } });
    const now = Date.now();
    const timestamp = unit === "seconds" ? String(Math.floor(now / 1000))
      : unit === "go_time_utc" ? `${new Date(now).toISOString().slice(0, -1).replace("T", " ")}123456 +0000 UTC m=+12345.123456789`
      : unit === "go_time_cst" ? `${new Date(now + 8 * 3600000).toISOString().slice(0, -1).replace("T", " ")}123456 +0800 CST m=+12345.123456789`
      : unit === "microseconds" ? String(BigInt(now) * 1000n)
      : unit === "nanoseconds" ? String(BigInt(now) * 1000000n)
      : unit === "decimal" ? `${now}.000`
      : unit === "scientific" ? `${now}e3` : String(now);
    const nonce = "synthetic-nonce";
    const response = await send(envelope, {
      "X-Lark-Request-Timestamp": timestamp, "X-Lark-Request-Nonce": nonce,
      "X-Lark-Signature": calculateFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody: JSON.stringify(envelope) }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ toast: { type: "success" }, card: { type: "raw" } });
    expect(approval.reviewKeyGenerationRequest).toHaveBeenCalledOnce();
    expect(approval.reviewKeyGenerationRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 42, expectedRequestNo: "KGR-SYNTHETIC", decision: "APPROVE",
    }));
    expect(console.warn).not.toHaveBeenCalled();
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    for (const secret of [token, encryptKey, nonce, timestamp, "ou_synthetic_approver", "KGR-SYNTHETIC"]) {
      expect(logs).not.toContain(secret);
    }
  });

  it("still requires the application and approval group for real card actions", async () => {
    const response = await send({ header: { token, event_type: "card.action.trigger" } });
    expect(response.status).toBe(503);
    expect(approval.reviewKeyGenerationRequest).not.toHaveBeenCalled();
  });
});
