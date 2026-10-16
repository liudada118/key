import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs, licenseKeys, users } from "../drizzle/schema";
import { decodeLicenseKey, generateLicenseKey } from "../shared/crypto";

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("./db", () => ({ getDb: async () => fixture.db }));
import { registerLegacyOnlineLicense } from "./legacyLicenseImport";

const rows = new Map<string, Record<string, unknown>[]>();
let rejectAudit = false;

/** Model the registration transaction and roll back both license and audit on failure. */
function store() {
  return {
    select() { return { from(table: Parameters<typeof getTableName>[0]) { return { where(condition: Parameters<MySqlDialect["sqlToQuery"]>[0]) {
      const params = new MySqlDialect().sqlToQuery(condition).params;
      const selected = (rows.get(getTableName(table)) || []).filter(row => table === users
        ? row.id === params[0] && row.role === params[1] && row.isActive === params[2]
        : row.keyHash === params[0] || row.keyString === params[1]);
      return { limit() { return { async for() { return selected; } }; } };
    } }; } }; },
    insert(table: Parameters<typeof getTableName>[0]) { return { async values(value: Record<string, unknown>) {
      if (table === auditLogs && rejectAudit) throw new Error("audit unavailable");
      const current = rows.get(getTableName(table)) || [], id = current.length + 1;
      current.push({ isDeleted: false, ...value, id }); rows.set(getTableName(table), current);
      return [{ insertId: id }];
    } }; },
    async transaction<T>(operation: (tx: ReturnType<typeof store>) => Promise<T>): Promise<T> {
      const before = structuredClone(rows);
      try { return await operation(fixture.db as ReturnType<typeof store>); }
      catch (error) { rows.clear(); for (const [name, values] of before) rows.set(name, values); throw error; }
    },
  };
}

/** Build an explicit reviewed import command without customer secrets. */
function options(apply = false) {
  return { keyString: generateLicenseKey(["hand"], 2), operatorId: 1, reason: "Verified historical issuance record", apply };
}

beforeEach(() => {
  rows.clear(); rejectAudit = false; fixture.db = store();
  rows.set(getTableName(users), [{ id: 1, role: "super_admin", isActive: true, username: "reviewer" }]);
});

describe("reviewed legacy license registration", () => {
  it("defaults to a preview without creating a license or audit", async () => {
    expect(await registerLegacyOnlineLicense(options())).toMatchObject({ outcome: "DRY_RUN", applied: false });
    expect(rows.get(getTableName(licenseKeys))).toBeUndefined();
    expect(rows.get(getTableName(auditLogs))).toBeUndefined();
  });

  it("preserves the exact original string, scope and expiration and never audits the raw key", async () => {
    const input = options(true), decoded = decodeLicenseKey(input.keyString);
    expect(await registerLegacyOnlineLicense(input)).toMatchObject({ outcome: "REGISTERED", applied: true });
    expect(rows.get(getTableName(licenseKeys))?.[0]).toMatchObject({ keyString: input.keyString,
      sensorType: decoded.sensorType, expireTimestamp: decoded.expireTimestamp });
    expect(JSON.stringify(rows.get(getTableName(auditLogs)))).not.toContain(input.keyString);
    expect(await registerLegacyOnlineLicense(input)).toMatchObject({ outcome: "EXISTS", applied: false });
    expect(rows.get(getTableName(licenseKeys))).toHaveLength(1);
    expect(rows.get(getTableName(auditLogs))).toHaveLength(1);
  });

  it.each([{ role: "admin", isActive: true }, { role: "super_admin", isActive: false }])("rejects an unauthorized operator %s", async account => {
    rows.set(getTableName(users), [{ id: 1, ...account }]);
    await expect(registerLegacyOnlineLicense(options(true))).rejects.toThrow("ACTIVE_SUPER_ADMIN_REQUIRED");
    expect(rows.get(getTableName(licenseKeys))).toBeUndefined();
  });

  it.each(["REVOKED", "SUSPENDED", "TAMPERED", "EXPIRED", "DELETED"])("does not revive an existing %s record", async status => {
    const input = options(true);
    rows.set(getTableName(licenseKeys), [{ id: 5, keyString: input.keyString, status,
      isDeleted: status === "DELETED", expireTimestamp: Date.now() + 86400000 }]);
    await expect(registerLegacyOnlineLicense(input)).rejects.toThrow("EXISTING_LICENSE_INACTIVE");
    expect(rows.get(getTableName(licenseKeys))).toHaveLength(1);
    expect(rows.get(getTableName(auditLogs))).toBeUndefined();
  });

  it("rolls back registration when audit persistence fails", async () => {
    rejectAudit = true;
    await expect(registerLegacyOnlineLicense(options(true))).rejects.toThrow("audit unavailable");
    expect(rows.get(getTableName(licenseKeys))).toBeUndefined();
  });

  it("rejects missing review, invalid license and unavailable storage", async () => {
    await expect(registerLegacyOnlineLicense({ ...options(true), reason: "" })).rejects.toThrow("REVIEW_REASON_REQUIRED");
    await expect(registerLegacyOnlineLicense({ ...options(true), keyString: "invalid" })).rejects.toThrow("LICENSE_INVALID");
    await expect(registerLegacyOnlineLicense({ ...options(true), keyString: generateLicenseKey(["hand"], -1) })).rejects.toThrow("LICENSE_INVALID_OR_EXPIRED");
    fixture.db = null;
    await expect(registerLegacyOnlineLicense(options(true))).rejects.toThrow("LICENSE_STORAGE_UNAVAILABLE");
  });
});
