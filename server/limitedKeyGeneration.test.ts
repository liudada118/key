import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const storage = vi.hoisted(() => ({
  insertLicenseKey: vi.fn(), insertLicenseKeys: vi.fn(), generateOfflineActivationCode: vi.fn(),
  getLicenseKeys: vi.fn(), getOfflineKeys: vi.fn(), getOfflineKeyStats: vi.fn(),
  getUserAndSubordinateIds: vi.fn(), getManagedSensorGroups: vi.fn(), getSensorValuesByGroups: vi.fn(),
  getSensorTypesGrouped: vi.fn(), createAuditLog: vi.fn(),
  reissueLicenseKey: vi.fn(),
}));
const devices = vi.hoisted(() => ({ readDevicePolicy: vi.fn() }));
vi.mock("./db", async importOriginal => ({ ...await importOriginal<typeof import("./db")>(), ...storage }));
vi.mock("./licenseDevices", async importOriginal => ({ ...await importOriginal<typeof import("./licenseDevices")>(), ...devices }));
import { appRouter } from "./routers";

/** Build an authenticated caller without network or a database. */
function caller(role: "user" | "admin" | "super_admin") {
  return appRouter.createCaller({
    user: { id: 7, role, name: "Test issuer", username: "issuer" },
    req: { protocol: "http", headers: {} }, res: {},
  } as TrpcContext);
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.getUserAndSubordinateIds.mockResolvedValue([7, 8]);
  storage.getManagedSensorGroups.mockResolvedValue(["precision"]);
  storage.getSensorValuesByGroups.mockResolvedValue(["hand"]);
  storage.getLicenseKeys.mockResolvedValue({ items: [], total: 0 });
  storage.getOfflineKeys.mockResolvedValue({ items: [], total: 0 });
  storage.getOfflineKeyStats.mockResolvedValue({ total: 0 });
  storage.getSensorTypesGrouped.mockResolvedValue([]);
  storage.generateOfflineActivationCode.mockImplementation(async input => input);
  storage.reissueLicenseKey.mockResolvedValue({ newKey: { id: 2 }, oldKeyId: 1 });
  devices.readDevicePolicy.mockResolvedValue(0);
});

describe("limited license issuance permissions", () => {
  it.each(["user", "admin"] as const)("rejects every limited issuance route for %s before persisting", async role => {
    const user = caller(role);
    await expect(user.keys.generate({ sensorTypes: "hand", days: 30, category: "production", deviceLimit: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(user.keys.batchGenerate({ sensorTypes: "hand", days: 30, category: "rental", count: 2, deviceLimit: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(user.offlineKeys.generate({ sensorTypes: ["hand"], days: 30, deviceLimit: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.insertLicenseKey).not.toHaveBeenCalled();
    expect(storage.insertLicenseKeys).not.toHaveBeenCalled();
    expect(storage.generateOfflineActivationCode).not.toHaveBeenCalled();
  });

  it.each([undefined, 0])("keeps ordinary issuance available with deviceLimit %s", async deviceLimit => {
    const user = caller("user");
    await expect(user.keys.generate({ sensorTypes: "hand", days: 30, category: "production", deviceLimit })).resolves.toMatchObject({ deviceLimit: 0, deviceRestricted: false });
    await user.keys.batchGenerate({ sensorTypes: "hand", days: 30, category: "production", count: 2, deviceLimit });
    await user.offlineKeys.generate({ sensorTypes: ["hand"], days: 30, deviceLimit });
    expect(storage.insertLicenseKey).toHaveBeenCalledWith(expect.objectContaining({ category: "production", createdById: 7 }), 0);
    expect(storage.insertLicenseKeys).toHaveBeenCalledWith(expect.any(Array), 0);
    expect(storage.generateOfflineActivationCode).toHaveBeenCalledWith(expect.objectContaining({ deviceLimit: 0 }));
  });

  it("passes the limit into the atomic store and returns usable metadata for super_admin", async () => {
    const admin = caller("super_admin");
    const single = await admin.keys.generate({ sensorTypes: "hand", days: 30, category: "production", deviceLimit: 3 });
    expect(single).toMatchObject({ deviceLimit: 3, deviceRestricted: true });
    expect(storage.insertLicenseKey).toHaveBeenCalledWith(expect.any(Object), 3);
    const batch = await admin.keys.batchGenerate({ sensorTypes: "hand", days: 30, category: "rental", count: 2, deviceLimit: 4 });
    expect(batch.keys.every(key => key.deviceLimit === 4 && key.deviceRestricted)).toBe(true);
    expect(storage.insertLicenseKeys).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ category: "rental" })]), 4);
    await admin.offlineKeys.generate({ sensorTypes: ["hand"], days: 30, deviceLimit: 5 });
    expect(storage.generateOfflineActivationCode).toHaveBeenCalledWith(expect.objectContaining({ deviceLimit: 5, createdById: 7 }));
  });

  it("does not report generation success when the limited transaction fails", async () => {
    storage.insertLicenseKeys.mockRejectedValueOnce(new Error("policy insert failed"));
    await expect(caller("super_admin").keys.batchGenerate({ sensorTypes: "hand", days: 30, category: "production", count: 2, deviceLimit: 1 })).rejects.toThrow("policy insert failed");
    expect(storage.createAuditLog).not.toHaveBeenCalled();
  });

  it("restricts limited-key reissue while retaining ordinary administrator reissue", async () => {
    devices.readDevicePolicy.mockResolvedValue(2);
    await expect(caller("admin").keys.reissue({ keyId: 1, revokeOld: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.reissueLicenseKey).not.toHaveBeenCalled();
    await caller("super_admin").keys.reissue({ keyId: 1, revokeOld: true });
    expect(storage.reissueLicenseKey).toHaveBeenCalledWith(1, 7, "Test issuer", { revokeOld: true, issuerRole: "super_admin" });
    devices.readDevicePolicy.mockResolvedValue(0);
    await caller("admin").keys.reissue({ keyId: 1, revokeOld: true });
    expect(storage.reissueLicenseKey).toHaveBeenLastCalledWith(1, 7, "Test issuer", { revokeOld: true, issuerRole: "admin" });
  });
});

describe("device category query scope", () => {
  it.each([undefined, "all", "unlimited", "limited"] as const)("forwards %s without changing online ownership or department visibility", async deviceMode => {
    await caller("admin").keys.list({ page: 2, pageSize: 10, deviceMode, customerId: 12, category: "rental" });
    expect(storage.getLicenseKeys).toHaveBeenCalledWith(expect.objectContaining({ userIds: [7, 8], visibleSensorValues: ["hand"], page: 2, pageSize: 10, deviceMode, customerId: 12, category: "rental" }));
  });

  it("uses the same category in offline pagination and statistics", async () => {
    const user = caller("user");
    await user.offlineKeys.list({ page: 3, pageSize: 5, search: "customer", deviceMode: "limited" });
    await user.offlineKeys.stats({ deviceMode: "limited" });
    expect(storage.getOfflineKeys).toHaveBeenCalledWith({ userIds: [7, 8], page: 3, pageSize: 5, search: "customer", machineId: undefined, deviceMode: "limited" });
    expect(storage.getOfflineKeyStats).toHaveBeenCalledWith([7, 8], "limited");
    await user.offlineKeys.stats();
    expect(storage.getOfflineKeyStats).toHaveBeenLastCalledWith([7, 8], undefined);
  });

  it.each(["csv", "json"] as const)("limits %s export to the selected category and retains existing owner scope", async format => {
    await caller("admin").keys.export({ format, deviceMode: "limited", customerId: 12 });
    expect(storage.getLicenseKeys).toHaveBeenCalledWith(expect.objectContaining({ userIds: [7, 8], deviceMode: "limited", customerId: 12, page: 1, pageSize: 10000 }));
  });

  it("includes the effective computer limit in JSON and CSV exports", async () => {
    storage.getLicenseKeys.mockResolvedValue({ items: [{ keyString: "test-license", sensorType: "hand", category: "production", deviceLimit: 3, days: 30, expireTimestamp: Date.now() + 86400000, status: "ISSUED", createdAt: new Date() }], total: 1 });
    const user = caller("super_admin");
    const json = await user.keys.export({ format: "json", deviceMode: "limited" });
    expect(json).toEqual([expect.objectContaining({ 电脑数量上限: 3 })]);
    const csv = await user.keys.export({ format: "csv", deviceMode: "limited" });
    expect(csv).toContain("密钥类型,电脑数量上限,有效期天数");
    expect(csv).toContain("量产密钥,3,30");
  });
});
