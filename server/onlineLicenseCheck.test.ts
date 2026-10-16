import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateLicenseKey } from "../shared/crypto";

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
  it.each(["a".repeat(64), "", "invalid"])("explicitly rejects an unregistered modern client (%s)", async deviceId => {
    const response = await send({ key: generateLicenseKey(["hand"], 2), deviceId });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ valid: false, status: "LICENSE_NOT_REGISTERED", deviceLimit: 0 });
    expect(data.reason).toContain("补录原密钥"); expect(data.deviceLease).toBeUndefined();
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
});
