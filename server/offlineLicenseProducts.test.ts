import express from "express";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => store);
import { registerOfflineDeviceChecks } from "./licenseDevices";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
const servers: Server[] = [];
let row: any;
const transaction = vi.fn();
beforeEach(() => { vi.resetAllMocks(); store.getDb.mockImplementation(async () => ({
  select: () => ({ from() { return this; }, innerJoin() { return this; }, where() { return this; }, limit: async () => row ? [row] : [] }),
  transaction,
})); });
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
}))); });

function license(productType?: string, scope: string = "all") {
  const payload = Buffer.from(JSON.stringify({ productType, ...(productType === "shroom-sdk"
    ? { boundSensorTypes: scope, version: 5 } : { sensorTypes: scope, version: 2 }), expireDate: Date.now() + 86400000 })).toString("base64");
  const signer = createSign("RSA-SHA256"); signer.update(payload); signer.end();
  const key = Buffer.from(JSON.stringify({ payload, signature: signer.sign(rsa.privateKey, "base64") })).toString("base64");
  row = { publicKey, key: { id: 1, productType, activationCode: key, status: "ISSUED", expireDate: Date.now() + 86400000, isDeleted: false } };
  return key;
}

async function send(body: unknown) {
  // Deliberately register before a global JSON parser, as the application does.
  const app = express(); registerOfflineDeviceChecks(app); const server = createServer(app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/license/devices/check`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("offline device activation product isolation", () => {
  it.each([undefined, "shroom-desktop"])("rejects a desktop offline all key from SDK before binding (%s)", async product => {
    const response = await send({ key: license(product), productType: "shroom-sdk", deviceId: "a".repeat(64) });
    expect(await response.json()).toMatchObject({ valid: false, status: "PRODUCT_MISMATCH", productType: "shroom-desktop" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects an SDK offline key from legacy desktop requests", async () => {
    expect(await (await send({ key: license("shroom-sdk") })).json()).toMatchObject({ valid: false, status: "PRODUCT_MISMATCH" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("checks database product as well as the signed payload", async () => {
    const key = license("shroom-sdk"); row.key.productType = "shroom-desktop";
    expect(await (await send({ key, productType: "shroom-sdk" })).json()).toMatchObject({ valid: false, status: "PRODUCT_MISMATCH" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(["hand", "all", "@group:retired"])("returns SDK all-model features and a sixty-second grant for existing scope %s", async scope => {
    const key = license("shroom-sdk", scope);
    transaction.mockImplementation(async callback => callback({
      insert: () => ({ values: () => ({ onDuplicateKeyUpdate: async () => undefined }) }),
      select: () => ({ from() { return this; }, where() { return this; }, for: async () => [{ maxDevices: 0 }],
        then: (resolve: (value: unknown) => void) => Promise.resolve([]).then(resolve) }),
    }));
    const response = await send({ key, productType: "shroom-sdk" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ valid: true, productType: "shroom-sdk", sensorTypes: ["all"], isAllTypes: true,
      sdkFeatures: ["serial", "stream", "recording", "serial.raw"] });
    expect(data.leaseExpiresAt - data.time).toBe(60000);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it.each(["SUSPENDED", "REVOKED", "EXPIRED"])("all-model SDK access still rejects %s offline keys", async status => {
    const key = license("shroom-sdk", "hand");
    row.key.status = status;
    expect(await (await send({ key, productType: "shroom-sdk" })).json()).toMatchObject({ valid: false, status: "LICENSE_INACTIVE" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("all-model SDK offline access still observes the computer allowance", async () => {
    const key = license("shroom-sdk", "hand");
    transaction.mockImplementation(async callback => callback({
      insert: () => ({ values: () => ({ onDuplicateKeyUpdate: async () => undefined }) }),
      select: () => ({ from() { return this; }, where() { return this; }, for: async () => [{ maxDevices: 1 }],
        then: (resolve: (value: unknown) => void) => Promise.resolve([{ deviceId: "a".repeat(64), status: "active" }]).then(resolve) }),
    }));
    const result = await (await send({ key, productType: "shroom-sdk", deviceId: "b".repeat(64) })).json();
    expect(result).toMatchObject({ valid: false, status: "DEVICE_LIMIT_REACHED", deviceLimit: 1 });
    expect(result.leaseExpiresAt).toBe(result.time);
  });
});
