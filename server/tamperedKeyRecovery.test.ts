import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const storage = vi.hoisted(() => ({
  getLicenseKeyById: vi.fn(), getUserAndSubordinateIds: vi.fn(), clearKeyTamper: vi.fn(), createAuditLog: vi.fn(),
}));
vi.mock("./db", async importOriginal => ({ ...await importOriginal<typeof import("./db")>(), ...storage }));
import { appRouter } from "./routers";

/** Use isolated callers; no real key or database is modified by recovery tests. */
function caller(role: "admin" | "super_admin" | "user" | null, isActive = true) {
  return appRouter.createCaller({ user: role ? { id: 7, role, name: "Test admin", username: "admin", isActive } : null,
    req: { protocol: "http", headers: {} }, res: {},
  } as TrpcContext);
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.getLicenseKeyById.mockResolvedValue({ id: 349, createdById: 8, status: "TAMPERED", isDeleted: false });
  storage.getUserAndSubordinateIds.mockResolvedValue([7, 8]);
  storage.clearKeyTamper.mockResolvedValue({ id: 349, status: "ACTIVATED", keyString: "SYNTHETIC-ORIGINAL", expireTimestamp: 1819530282731 });
});

describe("restore original tampered key", () => {
  it.each(["admin", "super_admin"] as const)("permits %s recovery with the original key and expiry, and audits it", async role => {
    const result = await caller(role).keys.clearTamper({ keyId: 349 });
    expect(result).toMatchObject({ success: true, key: { id: 349, keyString: "SYNTHETIC-ORIGINAL", expireTimestamp: 1819530282731 } });
    expect(storage.clearKeyTamper).toHaveBeenCalledTimes(1);
    expect(storage.clearKeyTamper).toHaveBeenCalledWith(349, 7, "Test admin");
    expect(storage.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "RESTORE", resourceId: 349, userId: 7 }));
  });

  it.each([null, "user"] as const)("rejects role %s before reading or restoring a key", async role => {
    await expect(caller(role).keys.clearTamper({ keyId: 349 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.getLicenseKeyById).not.toHaveBeenCalled();
    expect(storage.clearKeyTamper).not.toHaveBeenCalled();
  });

  it("rejects a disabled administrator", async () => {
    await expect(caller("admin", false).keys.clearTamper({ keyId: 349 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.clearKeyTamper).not.toHaveBeenCalled();
  });

  it("does not let an administrator restore another department's key by guessing its ID", async () => {
    storage.getLicenseKeyById.mockResolvedValue({ id: 349, createdById: 999, status: "TAMPERED" });
    await expect(caller("admin").keys.clearTamper({ keyId: 349 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.clearKeyTamper).not.toHaveBeenCalled();
    expect(storage.createAuditLog).not.toHaveBeenCalled();
    await expect(caller("super_admin").keys.clearTamper({ keyId: 349 })).resolves.toMatchObject({ success: true });
  });

  it.each([undefined, { id: 349, isDeleted: true }])("does not recover a missing or deleted key (%#)", async row => {
    storage.getLicenseKeyById.mockResolvedValue(row);
    await expect(caller("super_admin").keys.clearTamper({ keyId: 349 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.clearKeyTamper).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])("rejects invalid key ID %s", async keyId => {
    await expect(caller("super_admin").keys.clearTamper({ keyId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.clearKeyTamper).not.toHaveBeenCalled();
  });

  it("does not report or audit success when recovery fails", async () => {
    storage.clearKeyTamper.mockRejectedValue(new Error("该密钥不是异常状态"));
    await expect(caller("admin").keys.clearTamper({ keyId: 349 })).rejects.toThrow("该密钥不是异常状态");
    expect(storage.createAuditLog).not.toHaveBeenCalled();
  });
});
