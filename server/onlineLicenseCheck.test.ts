import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aesEncrypt, generateLicenseKey } from "../shared/crypto";

const storage = vi.hoisted(() => ({ getDb: vi.fn(), getLicenseKeyByString: vi.fn(), markLicenseKeyActivated: vi.fn(),
  markLicenseKeyExpired: vi.fn(), recordClientTimeAndDetectTamper: vi.fn(), authorizeLicenseDevice: vi.fn() }));
vi.mock("./db", () => storage);
vi.mock("./licenseDevices", () => ({ authorizeLicenseDevice: storage.authorizeLicenseDevice }));
import { registerOnlineLicenseCheck } from "./onlineLicenseCheck";

const servers: Server[] = [];
beforeEach(() => {
  vi.resetAllMocks(); storage.getDb.mockResolvedValue({});
  storage.getLicenseKeyByString.mockResolvedValue(undefined);
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  })));
});

/** Exercise the actual REST handler on a private loopback listener using synthetic licenses. */
async function send(body: unknown) {
  const app = express(); app.use(express.json()); registerOnlineLicenseCheck(app);
  const server = createServer(app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/licenseCheck`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("online license registration boundary", () => {
  it.each(["all", "@group:precision"])("never interprets a desktop %s scope as an SDK license", async scope => {
    const response = await send({ key: generateLicenseKey(scope, 2), productType: "shroom-sdk", tamper: true });
    expect(await response.json()).toMatchObject({ valid: false, status: "PRODUCT_MISMATCH", productType: "shroom-desktop" });
    expect(storage.getDb).not.toHaveBeenCalled();
    expect(storage.recordClientTimeAndDetectTamper).not.toHaveBeenCalled();
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });

  it("rejects an SDK key from a legacy desktop request before mutation", async () => {
    const key = generateLicenseKey("all", 2, "production", "shroom-sdk");
    expect(await (await send({ key, tamper: true })).json()).toMatchObject({ valid: false, status: "PRODUCT_MISMATCH" });
    expect(storage.getDb).not.toHaveBeenCalled();
  });

  it("requires an authoritative SDK registration even for unlimited clients", async () => {
    const key = generateLicenseKey("all", 2, "production", "shroom-sdk");
    expect(await (await send({ key, productType: "shroom-sdk" })).json()).toMatchObject({ valid: false, status: "LICENSE_NOT_REGISTERED" });
  });

  it("rejects a ciphertext and database product disagreement before tamper or activation", async () => {
    const key = generateLicenseKey("hand", 2, "production", "shroom-sdk");
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, productType: "shroom-desktop", status: "ISSUED" });
    expect(await (await send({ key, productType: "shroom-sdk", tamper: true })).json()).toMatchObject({ valid: false, status: "PRODUCT_MISMATCH" });
    expect(storage.recordClientTimeAndDetectTamper).not.toHaveBeenCalled();
    expect(storage.markLicenseKeyActivated).not.toHaveBeenCalled();
  });

  it.each(["all", "hand", "@group:retired"])("returns all-model raw serial access for existing SDK scopes (%s)", async scope => {
    const key = aesEncrypt(JSON.stringify({ productType: "shroom-sdk", sdkFile: scope, date: Date.now() + 86400000 }));
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, productType: "shroom-sdk", keyString: key,
      status: "ACTIVATED", expireTimestamp: Date.now() + 86400000, isActivated: true });
    storage.authorizeLicenseDevice.mockResolvedValue({ allowed: true, code: "UNLIMITED", deviceLimit: 0 });
    const response = await (await send({ key, productType: "shroom-sdk" })).json();
    expect(response).toMatchObject({ valid: true, productType: "shroom-sdk", sensorTypes: ["all"], isAllTypes: true, scope: "all" });
    expect(response.leaseExpiresAt - response.time).toBe(60000);
    expect(response.sdkFeatures).toEqual(["serial", "stream", "recording", "serial.raw"]);
  });

  it.each(["SUSPENDED", "REVOKED", "TAMPERED", "EXPIRED"])("all-model SDK access still rejects %s licenses", async status => {
    const key = generateLicenseKey("hand", 2, "production", "shroom-sdk");
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, productType: "shroom-sdk", keyString: key,
      status, expireTimestamp: Date.now() + (status === "EXPIRED" ? -86400000 : 86400000), isActivated: true });
    const result = await (await send({ key, productType: "shroom-sdk" })).json();
    expect(result).toMatchObject({ valid: false, status });
    expect(result.leaseExpiresAt).toBe(result.time);
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });

  it("all-model SDK access still observes the computer limit", async () => {
    const key = generateLicenseKey("hand", 2, "production", "shroom-sdk");
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, productType: "shroom-sdk", keyString: key,
      status: "ACTIVATED", expireTimestamp: Date.now() + 86400000, isActivated: true });
    storage.authorizeLicenseDevice.mockResolvedValue({ allowed: false, code: "DEVICE_LIMIT_REACHED", deviceLimit: 1 });
    const result = await (await send({ key, productType: "shroom-sdk", deviceId: "a".repeat(64) })).json();
    expect(result).toMatchObject({ valid: false, status: "DEVICE_LIMIT_REACHED", deviceLimit: 1 });
    expect(result.leaseExpiresAt).toBe(result.time);
  });

  it("allows browser JSON preflight without processing a license", async () => {
    const app = express(); registerOnlineLicenseCheck(app); const server = createServer(app); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/licenseCheck`, { method: "OPTIONS" });
    expect(response.status).toBe(204); expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });
  it.each(["a".repeat(64), "", "invalid"])("explicitly rejects an unregistered modern client (%s)", async deviceId => {
    const response = await send({ key: generateLicenseKey(["hand"], 2), deviceId });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ valid: false, status: "LICENSE_NOT_REGISTERED", deviceLimit: 0 });
    expect(data.reason).toContain("密钥验证"); expect(data.deviceLease).toBeUndefined();
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });

  it("preserves unknown legacy unlimited requests without a computer identity", async () => {
    expect(await (await send({ key: generateLicenseKey(["hand"], 2) })).json())
      .toMatchObject({ valid: true, status: "UNKNOWN", deviceLimit: 0 });
  });

  it.each([null, "throws"])("reports unavailable storage rather than an unknown key (%s)", async state => {
    if (state === "throws") storage.getLicenseKeyByString.mockRejectedValue(new Error("sql secret"));
    else storage.getDb.mockResolvedValue(null);
    const response = await send({ key: generateLicenseKey(["hand"], 2), deviceId: "a".repeat(64) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "LICENSE_SERVICE_UNAVAILABLE" });
  });

  it("returns the exact signed allowance for a registered valid license", async () => {
    const key = generateLicenseKey(["hand"], 2);
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, keyString: key, status: "ACTIVATED",
      expireTimestamp: Date.now() + 86400000, isActivated: true });
    const deviceLease = { lease: { schemaVersion: 1, issuedAt: Date.now(), expiresAt: Date.now() + 1000 }, signature: "synthetic" };
    storage.authorizeLicenseDevice.mockResolvedValue({ allowed: true, code: "REGISTERED", deviceLimit: 3, deviceLease });
    expect(await (await send({ key, deviceId: "a".repeat(64) })).json())
      .toMatchObject({ valid: true, status: "ACTIVATED", deviceLimit: 3, deviceLease });
  });

  it("does not mint an allowance for a revoked existing key", async () => {
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, status: "REVOKED", expireTimestamp: Date.now() + 86400000 });
    expect(await (await send({ key: generateLicenseKey(["hand"], 2), deviceId: "a".repeat(64) })).json())
      .toMatchObject({ valid: false, status: "REVOKED" });
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });

  it("binds the signed allowance to canonical request hex even when the legacy row contains uppercase", async () => {
    const key = generateLicenseKey(["hand"], 2);
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, keyString: key.toUpperCase(), status: "ACTIVATED",
      expireTimestamp: Date.now() + 86400000, isActivated: true });
    storage.authorizeLicenseDevice.mockResolvedValue({ allowed: true, code: "REGISTERED", deviceLimit: 0 });
    await send({ key: `  ${key.toUpperCase()}\r\n`, deviceId: "a".repeat(64) });
    expect(storage.getLicenseKeyByString).toHaveBeenCalledWith(key);
    expect(storage.authorizeLicenseDevice).toHaveBeenCalledWith(expect.objectContaining({ keyString: key }), "a".repeat(64), expect.any(Number));
  });

  it("does not reactivate a soft-deleted record even if its legacy status is active", async () => {
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, keyString: "synthetic", status: "ACTIVATED", isDeleted: true,
      expireTimestamp: Date.now() + 86400000, isActivated: true });
    expect(await (await send({ key: generateLicenseKey(["hand"], 2), deviceId: "a".repeat(64) })).json())
      .toMatchObject({ valid: false, status: "REVOKED" });
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });
});
