import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => storage);
import { DEVICE_LEASE_MS, signLicenseDeviceLease } from "./licenseDevices";

let root: string, publicKey: string;
const now = 1792656000000, keyString = "ab".repeat(48), deviceId = "c".repeat(64);
beforeEach(() => {
  vi.resetAllMocks();
  root = mkdtempSync(path.join(tmpdir(), "key-device-lease-signing-"));
  const pair = generateKeyPairSync("ed25519"), keyPath = path.join(root, "signing.pem");
  writeFileSync(keyPath, pair.privateKey.export({ format: "pem", type: "pkcs8" }));
  publicKey = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", keyPath);
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("key-device-lease-signing-")) throw new Error("UNEXPECTED_TEST_DIRECTORY");
  rmSync(root, { recursive: true, force: true });
});

describe("signed computer allowance", () => {
  it.each([0, 3])("binds the exact key and computer without changing registrations (limit %i)", deviceLimit => {
    const result = signLicenseDeviceLease({ keyString, deviceId, deviceLimit, expireTimestamp: now + 2 * DEVICE_LEASE_MS }, now);
    expect(result.lease).toEqual({ schemaVersion: 1, keyHash: createHash("sha256").update(keyString).digest("hex"),
      deviceId, deviceLimit, issuedAt: now, expiresAt: now + DEVICE_LEASE_MS });
    expect(verify(null, Buffer.from(JSON.stringify(result.lease)), publicKey, Buffer.from(result.signature, "base64"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(keyString);
    expect(storage.getDb).not.toHaveBeenCalled();
  });

  it("never extends the original software expiration", () => {
    const result = signLicenseDeviceLease({ keyString, deviceId, deviceLimit: 0, expireTimestamp: now + 1000 }, now);
    expect(result.lease.expiresAt).toBe(now + 1000);
  });

  it.each(["deviceId", "keyHash", "expiresAt", "deviceLimit"])("rejects a copied or altered %s under the original signature", field => {
    const result = signLicenseDeviceLease({ keyString, deviceId, deviceLimit: 0, expireTimestamp: now + DEVICE_LEASE_MS }, now);
    const changed = { ...result.lease, [field]: field === "deviceId" ? "d".repeat(64) : field === "keyHash"
      ? createHash("sha256").update("cd".repeat(48)).digest("hex") : field === "deviceLimit" ? 1 : now + DEVICE_LEASE_MS + 1 };
    expect(verify(null, Buffer.from(JSON.stringify(changed)), publicKey, Buffer.from(result.signature, "base64"))).toBe(false);
  });

  it.each([
    { expireTimestamp: now }, { expireTimestamp: now - 1 }, { expireTimestamp: Number.NaN }, { expireTimestamp: Number.POSITIVE_INFINITY },
    { deviceId: "invalid" }, { deviceId: "A".repeat(64) }, { deviceLimit: -1 }, { deviceLimit: 1.5 }, { deviceLimit: 10001 }, { keyString: "" },
  ])("rejects malformed or expired lease inputs (%#)", invalid => {
    expect(() => signLicenseDeviceLease({ keyString, deviceId, deviceLimit: 0, expireTimestamp: now + DEVICE_LEASE_MS, ...invalid }, now))
      .toThrow("DEVICE_LEASE_INPUT_INVALID");
  });

  it("requires the existing configured Ed25519 signing key", () => {
    const input = { keyString, deviceId, deviceLimit: 0, expireTimestamp: now + DEVICE_LEASE_MS };
    vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", "");
    expect(() => signLicenseDeviceLease(input, now)).toThrow("SIGNING_KEY_UNCONFIGURED");
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), keyPath = path.join(root, "other.pem");
    writeFileSync(keyPath, pair.privateKey.export({ format: "pem", type: "pkcs8" }));
    vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", keyPath);
    expect(() => signLicenseDeviceLease(input, now)).toThrow("SIGNING_KEY_INVALID");
  });
});
