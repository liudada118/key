import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const storage = vi.hoisted(() => ({
  getLicenseKeys: vi.fn(), getUserAndSubordinateIds: vi.fn(),
  getSensorTypesGrouped: vi.fn(), createAuditLog: vi.fn(),
}));
vi.mock("./db", async importOriginal => ({ ...await importOriginal<typeof import("./db")>(), ...storage }));
import { appRouter } from "./routers";

beforeEach(() => {
  vi.resetAllMocks();
  storage.getUserAndSubordinateIds.mockResolvedValue([7]);
  storage.getSensorTypesGrouped.mockResolvedValue([]);
  storage.getLicenseKeys.mockResolvedValue({ items: [{
    keyString: "SYNTHETIC-NOT-A-LICENSE", sensorType: "hand", category: "production", days: 30,
    deviceLimit: 0, status: "ACTIVATED", isActivated: true,
    expireTimestamp: 1795686744244, createdAt: new Date("2026-10-27T09:52:24Z"),
    activatedAt: new Date("2026-10-27T10:00:00Z"),
  }], total: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe("key export timezone", () => {
  it.each(["UTC", "Asia/Shanghai", "America/Los_Angeles"])("exports CSV and JSON using the same Beijing time on a %s server", async timezone => {
    vi.stubEnv("TZ", timezone);
    const caller = appRouter.createCaller({ user: { id: 7, role: "super_admin", isActive: true },
      req: { headers: {} }, res: {},
    } as TrpcContext);
    const json = await caller.keys.export({ format: "json", deviceMode: "unlimited" });
    expect(json).toMatchObject([{
      创建时间: "2026/10/27 17:52:24", 到期时间: "2026/11/26 17:52:24", 激活时间: "2026/10/27 18:00:00",
      有效期天数: 30,
    }]);
    const csv = await caller.keys.export({ format: "csv", deviceMode: "unlimited" });
    expect(csv).toContain("2026/10/27 17:52:24");
    expect(csv).toContain("2026/11/26 17:52:24");
    expect(csv).toContain("2026/10/27 18:00:00");
    expect(storage.getLicenseKeys).toHaveBeenCalledWith(expect.objectContaining({ userIds: [7], deviceMode: "unlimited" }));
  });
});
