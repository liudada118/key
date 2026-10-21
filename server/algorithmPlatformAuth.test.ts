import express from "express";
import { createSign, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateLicenseKey } from "../shared/crypto";
import { createAlgorithmPlatformFixture } from "./testing/algorithmPlatformFixture";

const fixture = vi.hoisted(() => ({ batches: [] as unknown[][] }));
/** 用排队资料替换数据库连接，密钥解析、签名校验和HTTP认证保持真实。 */
function selection() {
  const builder: any = { from: () => builder, innerJoin: () => builder, where: () => builder, limit: () => builder,
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(fixture.batches.shift() || []).then(resolve) };
  return builder;
}
vi.mock("./db", () => ({ getDb: async () => ({ select: selection }) }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => null } }));
import { registerAlgorithmPlatform } from "./algorithmPlatform";

describe("算法平台正式身份解析", () => {
  const key = generateLicenseKey(["hand"], 1);
  const record = { productType: "shroom-desktop", keyString: key, customerId: 42, isDeleted: false,
    status: "ISSUED", expireTimestamp: Date.now() + 3600000 };
  let base: string, server: ReturnType<ReturnType<typeof express>["listen"]>;
  beforeAll(async () => {
    const app = express(); registerAlgorithmPlatform(app, { service: createAlgorithmPlatformFixture().service });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing port");
    base = `http://127.0.0.1:${address.port}/api/algorithm-platform`;
  });
  beforeEach(() => { fixture.batches = []; });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  /** 经正式密钥归属解析读取使用权，不注入客户身份。 */
  async function entitlements(licenseKey: string, batches: unknown[][]) {
    fixture.batches = batches;
    const response = await fetch(base + "/entitlements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ licenseKey }) });
    return { response, body: await response.json() };
  }
  it("在线密钥需有效上位机产品并关联有效客户，不能沿用SDK或未关联密钥", async () => {
    expect((await entitlements(key, [[record], [{ id: 42, active: true }]])).response.status).toBe(200);
    expect((await entitlements(key, [[{ ...record, customerId: null }]])).response.status).toBe(403);
    expect((await entitlements(key, [[record], [{ id: 42, active: false }]])).body.error).toBe("CUSTOMER_INACTIVE");
    expect((await entitlements(key, [[{ ...record, productType: "shroom-sdk" }]])).body.error).toBe("PRODUCT_MISMATCH");
    expect((await entitlements(key, [[{ ...record, status: "REVOKED" }]])).response.status).toBe(403);
    expect((await entitlements(key, [[{ ...record, expireTimestamp: Date.now() - 1000 }]])).response.status).toBe(403);
  });
  it("离线密钥验证RSA签名和原始登记后才解析客户归属", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 }), expireDate = Date.now() + 3600000;
    const payload = Buffer.from(JSON.stringify({ sensorTypes: ["hand"], expireDate, issuedAt: Date.now(), version: 2 })).toString("base64");
    const signer = createSign("RSA-SHA256"); signer.update(payload); signer.end();
    const signature = signer.sign(pair.privateKey, "base64");
    const activationCode = Buffer.from(JSON.stringify({ payload, signature })).toString("base64");
    const row = { productType: "shroom-desktop", activationCode, status: "ISSUED", isDeleted: false, customerId: 42,
      expireDate, publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString() };
    expect((await entitlements(activationCode, [[row], [{ id: 42, active: true }]])).response.status).toBe(200);
    const forged = Buffer.from(JSON.stringify({ payload, signature: "bad" })).toString("base64");
    expect((await entitlements(forged, [[{ ...row, activationCode: forged }]])).response.status).toBe(403);
  });
  it("真实员工令牌校验到期/撤销与账号，不能借超管令牌进入审核或跨站请求", async () => {
    const token = "sps_" + "b".repeat(43), headers = { authorization: `Bearer ${token}` };
    fixture.batches = [[{ id: 2, role: "super_admin", active: true, revokedAt: null, expiresAt: new Date(Date.now() + 3600000) }]];
    expect((await fetch(base + "/admin/workspace", { headers })).status).toBe(403);
    fixture.batches = [[{ id: 2, role: "super_admin", active: true, revokedAt: new Date(), expiresAt: new Date(Date.now() + 3600000) }]];
    expect((await fetch(base + "/submissions", { headers })).status).toBe(403);
    expect((await fetch(base + "/submissions", { headers: { ...headers, origin: "https://untrusted.example" } })).status).toBe(403);
    expect((await fetch(base + "/submissions")).status).toBe(403);
  });
});
