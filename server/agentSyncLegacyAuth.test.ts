import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aesEncrypt, generateLicenseKey } from "../shared/crypto";

let selections: unknown[][] = [];
let inserted: Record<string, unknown>[] = [];
const source = (licenseKeyId: number | null = null) => [{ id: 701, licenseKeyId }];
vi.mock("./db", () => ({ getDb: async () => ({
  select: () => {
    const builder = { from: () => builder, leftJoin: () => builder, where: () => builder,
      limit: async () => selections.shift() || [] };
    return builder;
  },
  insert: () => ({ values: (value: Record<string, unknown>) => { inserted.push(value); return { onDuplicateKeyUpdate: async () => {} }; } }),
}) }));
import { authenticateLicenseUpload } from "./agentSyncStore";
import { authenticateUsage } from "./usageStore";

function legacy(expiry = Date.now() + 86400000, version = 1) {
  return aesEncrypt(JSON.stringify({ date: expiry, file: "all", ...(version > 1 ? { v: version, cat: "production" } : {}) }));
}
beforeEach(() => { selections = []; inserted = []; });

describe("legacy online license chat uploads", () => {
  it("does not relax the shared authentication used by usage analytics", async () => {
    selections = [[]];
    await expect(authenticateUsage(legacy())).rejects.toMatchObject({ status: 401, code: "INVALID_LICENSE" });
    expect(inserted).toHaveLength(0);
  });
  it.each([1, 2])("accepts a valid unregistered v%s key without storing the secret or creating a license", async version => {
    const key = legacy(undefined, version);
    selections = [[], source()];
    expect(await authenticateLicenseUpload(key)).toEqual({ tenantId: 701, credentialId: 0 });
    expect(inserted).toEqual([{ licenseKeyHash: createHash("sha256").update(key).digest("hex") }]);
    expect(JSON.stringify(inserted)).not.toContain(key);
  });

  it("canonicalizes hex casing and reuses the hash when a legacy key is later registered", async () => {
    const key = legacy();
    selections = [[], source()];
    const first = await authenticateLicenseUpload(key.toUpperCase());
    selections = [[{ id: 12, status: "ISSUED", expiresAt: Date.now() + 86400000, deleted: false, customerId: null }], source(12)];
    expect(await authenticateLicenseUpload(key)).toEqual(first);
    expect(inserted[1]).toEqual({ ...inserted[0], licenseKeyId: 12 });
  });

  it.each(["SUSPENDED", "REVOKED", "TAMPERED", "EXPIRED"])("does not bypass a registered %s key", async status => {
    selections = [[{ id: 12, status, expiresAt: Date.now() + 86400000, deleted: false, customerId: null }]];
    await expect(authenticateLicenseUpload(legacy())).rejects.toMatchObject({ status: 403, code: "LICENSE_UNAVAILABLE" });
    expect(inserted).toHaveLength(0);
  });

  it("rejects expired unregistered keys, malformed keys, deleted registrations and inactive customers", async () => {
    selections = [[]];
    await expect(authenticateLicenseUpload(legacy(Date.now() - 1))).rejects.toMatchObject({ status: 403 });
    await expect(authenticateLicenseUpload("ff".repeat(48))).rejects.toMatchObject({ status: 401 });
    for (const patch of [{ deleted: true }, { expiresAt: Date.now() - 1 }, { customerId: 1, customerActive: false }]) {
      selections = [[{ id: 12, status: "ACTIVATED", expiresAt: Date.now() + 86400000, deleted: false, customerId: null, ...patch }]];
      await expect(authenticateLicenseUpload(legacy())).rejects.toMatchObject({ status: 403 });
    }
    expect(inserted).toHaveLength(0);
  });

  it("preserves server-side renewal of registered keys and denies SDK keys", async () => {
    selections = [[{ id: 12, status: "RENEWED", expiresAt: Date.now() + 86400000, deleted: false, customerId: null }], source(12)];
    expect(await authenticateLicenseUpload(legacy(Date.now() - 1000))).toEqual({ tenantId: 701, credentialId: 0 });
    const before = inserted.length;
    await expect(authenticateLicenseUpload(generateLicenseKey("all", 30, "production", "shroom-sdk"))).rejects.toMatchObject({ status: 403, code: "PRODUCT_MISMATCH" });
    expect(inserted).toHaveLength(before);
  });

  it("does not resurrect a hard-deleted registration through an existing legacy source", async () => {
    selections = [[], source(12)];
    await expect(authenticateLicenseUpload(legacy())).rejects.toMatchObject({ status: 403, code: "LICENSE_UNAVAILABLE" });
  });
});
