import express from "express";
import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aesEncrypt, generateLicenseKey } from "../shared/crypto";

const storage = vi.hoisted(() => ({ getDb: vi.fn(), getLicenseKeyByString: vi.fn(), markLicenseKeyActivated: vi.fn(),
  markLicenseKeyExpired: vi.fn(), recordClientTimeAndDetectTamper: vi.fn(), authorizeLicenseDevice: vi.fn() }));
vi.mock("./db", () => storage);
vi.mock("./licenseDevices", async importOriginal => ({
  ...await importOriginal<typeof import("./licenseDevices")>(), authorizeLicenseDevice: storage.authorizeLicenseDevice,
}));
import { registerOnlineLicenseCheck } from "./onlineLicenseCheck";

const servers: Server[] = [];
let signingRoot: string, signingPublicKey: string;
beforeEach(() => {
  vi.resetAllMocks(); storage.getDb.mockResolvedValue({});
  storage.getLicenseKeyByString.mockResolvedValue(undefined);
  signingRoot = mkdtempSync(path.join(tmpdir(), "key-online-license-signing-"));
  const pair = generateKeyPairSync("ed25519"), keyPath = path.join(signingRoot, "signing.pem");
  writeFileSync(keyPath, pair.privateKey.export({ format: "pem", type: "pkcs8" }));
  signingPublicKey = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", keyPath);
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  })));
  vi.unstubAllEnvs();
  if (path.dirname(path.resolve(signingRoot)) !== path.resolve(tmpdir()) || !path.basename(signingRoot).startsWith("key-online-license-signing-")) throw new Error("UNEXPECTED_TEST_DIRECTORY");
  rmSync(signingRoot, { recursive: true, force: true });
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
  it.each(["", "invalid", "A".repeat(64), 123])("rejects an invalid legacy computer identity (%s)", async deviceId => {
    const response = await send({ key: generateLicenseKey(["hand"], 2), deviceId });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ valid: false, status: "DEVICE_ID_REQUIRED", deviceLimit: 0 });
    expect(data.deviceLease).toBeUndefined();
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });

  it.each(["all", "hand", "@group:precision"])("automatically signs an unlimited legacy %s allowance without formal registration", async scope => {
    const key = generateLicenseKey(scope, 20), deviceId = "a".repeat(64);
    const response = await send({ key: `  ${key.toUpperCase()}\r\n`, deviceId });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ valid: true, status: "LEGACY_VALID", deviceLimit: 0, scope,
      deviceLease: { lease: { schemaVersion: 1, deviceId, deviceLimit: 0, keyHash: createHash("sha256").update(key).digest("hex") } } });
    expect(data.deviceLease.lease.issuedAt).toBe(data.time);
    expect(data.deviceLease.lease.expiresAt).toBe(data.time + 7 * 86400000);
    expect(verify(null, Buffer.from(JSON.stringify(data.deviceLease.lease)), signingPublicKey, Buffer.from(data.deviceLease.signature, "base64"))).toBe(true);
    expect(storage.getLicenseKeyByString).toHaveBeenCalledWith(key);
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
    expect(storage.markLicenseKeyActivated).not.toHaveBeenCalled();
    expect(storage.recordClientTimeAndDetectTamper).not.toHaveBeenCalled();
  });

  it("caps a legacy allowance at the original license expiration", async () => {
    const expireTimestamp = Date.now() + 60000;
    const key = aesEncrypt(JSON.stringify({ file: ["hand"], date: expireTimestamp }));
    const data = await (await send({ key, deviceId: "b".repeat(64) })).json();
    expect(data).toMatchObject({ valid: true, status: "LEGACY_VALID", expireTimestamp, scope: ["hand"], sensorTypes: ["hand"], isAllTypes: false,
      deviceLease: { lease: { expiresAt: expireTimestamp, deviceLimit: 0 } } });
  });

  it("does not sign an expired legacy license or a client reporting tampering", async () => {
    vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", "");
    const expired = await send({ key: generateLicenseKey(["hand"], -1), deviceId: "a".repeat(64) });
    expect(expired.status).toBe(200);
    expect(await expired.json()).toMatchObject({ valid: false, status: "EXPIRED" });
    const tampered = await send({ key: generateLicenseKey(["hand"], 2), deviceId: "a".repeat(64), tamper: true });
    expect(tampered.status).toBe(200);
    expect(await tampered.json()).toMatchObject({ valid: false, status: "TAMPERED" });
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });

  it.each(["not-a-license", aesEncrypt(JSON.stringify({ file: "@group:unknown-test-category", date: Date.now() + 86400000 }))])("does not sign malformed or invalid-scope ciphertext (%#)", async key => {
    const response = await send({ key, deviceId: "a".repeat(64) });
    const data = await response.json();
    expect(data).toMatchObject({ valid: false, status: "INVALID" });
    expect(data.deviceLease).toBeUndefined();
    expect(storage.getDb).not.toHaveBeenCalled();
  });

  it.each(["missing", "unreadable", "invalid"])("does not fall back to unsigned legacy access when signing is %s", async state => {
    if (state === "missing") vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", "");
    else if (state === "unreadable") vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", path.join(signingRoot, "missing.pem"));
    else writeFileSync(path.join(signingRoot, "signing.pem"), "invalid signing key");
    const response = await send({ key: generateLicenseKey(["hand"], 2), deviceId: "a".repeat(64) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "LICENSE_SERVICE_UNAVAILABLE" });
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

  it.each(["SUSPENDED", "REVOKED", "TAMPERED", "EXPIRED"])("never replaces an existing %s record with legacy authorization", async status => {
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, status, expireTimestamp: Date.now() + (status === "EXPIRED" ? -86400000 : 86400000) });
    expect(await (await send({ key: generateLicenseKey(["hand"], 2), deviceId: "a".repeat(64) })).json())
      .toMatchObject({ valid: false, status });
    expect(storage.authorizeLicenseDevice).not.toHaveBeenCalled();
  });

  it.each(["DEVICE_LIMIT_REACHED", "DEVICE_REVOKED"])("preserves an existing desktop computer policy denial (%s)", async code => {
    storage.getLicenseKeyByString.mockResolvedValue({ id: 7, status: "ACTIVATED", isActivated: true, expireTimestamp: Date.now() + 86400000 });
    storage.authorizeLicenseDevice.mockResolvedValue({ allowed: false, code, deviceLimit: 1 });
    const data = await (await send({ key: generateLicenseKey(["hand"], 2), deviceId: "a".repeat(64) })).json();
    expect(data).toMatchObject({ valid: false, status: code, deviceLimit: 1 });
    expect(data.deviceLease).toBeUndefined();
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
