import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const approval = vi.hoisted(() => ({ reviewKeyGenerationRequest: vi.fn(), getActiveSuperAdmin: vi.fn() }));
vi.mock("./keyGenerationRequestApproval", () => ({ reviewKeyGenerationRequest: approval.reviewKeyGenerationRequest }));
vi.mock("./db", () => ({ getActiveSuperAdmin: approval.getActiveSuperAdmin }));
import { FEISHU_KEY_REQUEST_CALLBACK_PATH, registerFeishuKeyRequestCardCallback } from "./feishuKeyRequestCardCallback";

const token = "synthetic-verification-token", encryptKey = "synthetic-encrypt-key";
let server: Server | undefined;
beforeEach(() => {
  vi.clearAllMocks();
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
});
async function send(payload: unknown) {
  if (!server) {
    const app = express();
    registerFeishuKeyRequestCardCallback(app);
    app.use(express.json({ limit: "50mb" }));
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  }
  const port = (server.address() as { port: number }).port;
  return fetch(`http://127.0.0.1:${port}${FEISHU_KEY_REQUEST_CALLBACK_PATH}`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(payload),
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
  });

  it("still requires the application and approval group for real card actions", async () => {
    const response = await send({ header: { token, event_type: "card.action.trigger" } });
    expect(response.status).toBe(503);
    expect(approval.reviewKeyGenerationRequest).not.toHaveBeenCalled();
  });
});
