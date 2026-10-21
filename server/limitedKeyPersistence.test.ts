import { createVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { licenseDevicePolicies, licenseKeys, offlineKeys, rsaKeyPairs } from "../drizzle/schema";

const fake = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fake.db }));
import { generateOfflineActivationCode, insertLicenseKeys, reissueLicenseKey } from "./db";
import { decodeLicenseKey } from "../shared/crypto";

type StoredRow = Record<string, unknown>;
const rows = new Map<string, StoredRow[]>();
let failPolicyNumber = 0, policyAttempts = 0;

/** Exercise the production issuance callback with an atomic rollback-capable storage fixture. */
function store() {
  return {
    insert(table: Parameters<typeof getTableName>[0]) {
      const name = getTableName(table);
      return { values(value: StoredRow | StoredRow[]) {
        const result = (async () => {
          if (name === getTableName(licenseDevicePolicies) && ++policyAttempts === failPolicyNumber) throw new Error("policy insert failed");
          const current = rows.get(name) || [];
          const insertId = current.length + 1;
          for (const item of Array.isArray(value) ? value : [value]) {
            if (name === getTableName(licenseDevicePolicies) && current.some(row => row.keyType === item.keyType && row.keyId === item.keyId)) continue;
            current.push({ ...item, id: current.length + 1 });
          }
          rows.set(name, current);
          return [{ insertId }];
        })();
        return Object.assign(result, { onDuplicateKeyUpdate: () => result });
      } };
    },
    update() { return { async set() {} }; },
    select() { return { from(table: Parameters<typeof getTableName>[0]) { return { where(condition: Parameters<MySqlDialect["sqlToQuery"]>[0]) {
      const parameters = new MySqlDialect().sqlToQuery(condition).params;
      let selected = rows.get(getTableName(table)) || [];
      if (table === licenseKeys && typeof parameters[0] === "number") selected = selected.filter(row => row.id === parameters[0]);
      if (table === licenseDevicePolicies) selected = selected.filter(row => row.keyType === parameters[0] && row.keyId === parameters[1]);
      return { async limit() { return selected; }, async for() { return selected; } };
    } }; } }; },
    async transaction<T>(operation: (tx: ReturnType<typeof store>) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(rows);
      try { return await operation(fake.db as ReturnType<typeof store>); }
      catch (error) { rows.clear(); for (const [name, items] of snapshot) rows.set(name, items); throw error; }
    },
  };
}

/** Create a minimal ordinary online record whose format remains unchanged by the policy. */
function onlineRecord(index: number) {
  return { keyString: `existing-compatible-key-${index}`, sensorType: "hand", category: "production" as const, days: 30, expireTimestamp: Date.now() + 86400000, createdById: 1 };
}

beforeEach(() => {
  rows.clear(); failPolicyNumber = 0; policyAttempts = 0;
  fake.db = store();
  vi.stubEnv("DATABASE_URL", "mysql://unused:unused@localhost/unused");
});

afterEach(() => vi.unstubAllEnvs());

describe("limited key atomic persistence", () => {
  it.each([0, 2])("signs and persists an SDK offline key with its product and computer limit (%s)", async deviceLimit => {
    const result = await generateOfflineActivationCode({ productType: "shroom-sdk", sensorTypes: ["hand"],
      days: 30, deviceLimit, createdById: 1, createdByName: "issuer" });
    const envelope = JSON.parse(Buffer.from(result.activationCode, "base64").toString("utf8"));
    const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
    expect(payload).toMatchObject({ productType: "shroom-sdk", boundSensorTypes: "all", version: 5, deviceLimit,
      sdkFeatures: ["serial", "stream", "recording", "serial.raw"] });
    expect(payload.sensorTypes).toBeUndefined();
    const verifier = createVerify("RSA-SHA256"); verifier.update(envelope.payload); verifier.end();
    expect(verifier.verify(rows.get(getTableName(rsaKeyPairs))![0].publicKey as string, envelope.signature, "base64")).toBe(true);
    expect(rows.get(getTableName(offlineKeys))?.[0]).toMatchObject({ productType: "shroom-sdk", sensorTypes: "all" });
    expect(policyAttempts).toBe(deviceLimit ? 1 : 0);
  });

  it("retains the SDK product identity during reissue", async () => {
    rows.set(getTableName(licenseKeys), [{ ...onlineRecord(1), id: 1, productType: "shroom-sdk" }]);
    const result = await reissueLicenseKey(1, 7, "issuer", { revokeOld: false, issuerRole: "admin" });
    expect(result.newKey.productType).toBe("shroom-sdk");
    expect(result.newKey.sensorType).toBe("all");
    expect(decodeLicenseKey(result.newKey.keyString).productType).toBe("shroom-sdk");
  });
  it("commits a computer policy for every generated online key", async () => {
    await insertLicenseKeys([onlineRecord(1), onlineRecord(2)], 3);
    expect(rows.get(getTableName(licenseKeys))).toHaveLength(2);
    expect(rows.get(getTableName(licenseDevicePolicies))).toEqual([
      { id: 1, keyType: "online", keyId: 1, maxDevices: 3 },
      { id: 2, keyType: "online", keyId: 2, maxDevices: 3 },
    ]);
  });

  it("rolls back all generated online keys when a later policy insert fails", async () => {
    failPolicyNumber = 2;
    await expect(insertLicenseKeys([onlineRecord(1), onlineRecord(2)], 1)).rejects.toThrow("policy insert failed");
    expect(rows.get(getTableName(licenseKeys)) || []).toEqual([]);
    expect(rows.get(getTableName(licenseDevicePolicies)) || []).toEqual([]);
  });

  it("does not require policy writes or change ordinary online records", async () => {
    failPolicyNumber = 1;
    await insertLicenseKeys([onlineRecord(1)], 0);
    expect(rows.get(getTableName(licenseKeys))?.[0]).toMatchObject({ keyString: "existing-compatible-key-1", category: "production", status: "ISSUED" });
    expect(policyAttempts).toBe(0);
  });

  it.each([undefined, 0])("preserves the legacy RSA v2 payload with deviceLimit %s", async deviceLimit => {
    const result = await generateOfflineActivationCode({ sensorTypes: ["hand"], days: 30, deviceLimit, createdById: 1, createdByName: "issuer" });
    const envelope = JSON.parse(Buffer.from(result.activationCode, "base64").toString("utf8"));
    const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
    expect(payload).toEqual({ sensorTypes: "hand", version: 2, expireDate: expect.any(Number), issuedAt: expect.any(Number) });
    const verifier = createVerify("RSA-SHA256"); verifier.update(envelope.payload); verifier.end();
    expect(verifier.verify(rows.get(getTableName(rsaKeyPairs))![0].publicKey as string, envelope.signature, "base64")).toBe(true);
    expect(policyAttempts).toBe(0);
  });

  it("atomically persists the existing v4 offline format and its initial policy", async () => {
    const result = await generateOfflineActivationCode({ sensorTypes: ["hand"], days: 30, deviceLimit: 2, createdById: 1, createdByName: "issuer" });
    const envelope = JSON.parse(Buffer.from(result.activationCode, "base64").toString("utf8"));
    expect(JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"))).toMatchObject({ version: 4, boundSensorTypes: "hand", deviceLimit: 2 });
    expect(rows.get(getTableName(licenseDevicePolicies))).toEqual([{ id: 1, keyType: "offline", keyId: 1, maxDevices: 2 }]);
  });

  it("does not leave an offline license behind when initial policy storage fails", async () => {
    failPolicyNumber = 1;
    await expect(generateOfflineActivationCode({ sensorTypes: ["hand"], days: 30, deviceLimit: 2, createdById: 1, createdByName: "issuer" })).rejects.toThrow("policy insert failed");
    expect(rows.get(getTableName(offlineKeys)) || []).toEqual([]);
  });

  it("preserves the computer limit when a super administrator reissues a key", async () => {
    rows.set(getTableName(licenseKeys), [{ ...onlineRecord(1), id: 1 }]);
    rows.set(getTableName(licenseDevicePolicies), [{ id: 1, keyType: "online", keyId: 1, maxDevices: 2 }]);
    const result = await reissueLicenseKey(1, 7, "issuer", { revokeOld: false, issuerRole: "super_admin" });
    expect(result.newKey).toMatchObject({ id: 2, deviceLimit: 2, deviceRestricted: true });
    expect(rows.get(getTableName(licenseDevicePolicies))?.find(row => row.keyId === 2)).toMatchObject({ maxDevices: 2 });
  });

  it("rolls back a replacement key when copying its computer policy fails", async () => {
    rows.set(getTableName(licenseKeys), [{ ...onlineRecord(1), id: 1 }]);
    rows.set(getTableName(licenseDevicePolicies), [{ id: 1, keyType: "online", keyId: 1, maxDevices: 2 }]);
    failPolicyNumber = 2;
    await expect(reissueLicenseKey(1, 7, "issuer", { revokeOld: false, issuerRole: "super_admin" })).rejects.toThrow("policy insert failed");
    expect(rows.get(getTableName(licenseKeys))).toHaveLength(1);
    expect(rows.get(getTableName(licenseDevicePolicies))).toHaveLength(1);
  });

  it("rechecks issuer permission under the policy lock before reissuing", async () => {
    rows.set(getTableName(licenseKeys), [{ ...onlineRecord(1), id: 1 }]);
    rows.set(getTableName(licenseDevicePolicies), [{ id: 1, keyType: "online", keyId: 1, maxDevices: 2 }]);
    await expect(reissueLicenseKey(1, 7, "issuer", { revokeOld: false, issuerRole: "admin" })).rejects.toThrow("仅超级管理员");
    expect(rows.get(getTableName(licenseKeys))).toHaveLength(1);
  });

  it("retains ordinary administrator reissue for an unlimited source", async () => {
    rows.set(getTableName(licenseKeys), [{ ...onlineRecord(1), id: 1 }]);
    const result = await reissueLicenseKey(1, 7, "issuer", { revokeOld: false, issuerRole: "admin" });
    expect(result.newKey).toMatchObject({ id: 2, deviceLimit: 0, deviceRestricted: false });
  });
});
