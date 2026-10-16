import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
vi.mock("./feishuCustomerSync", () => ({ syncFeishuCustomersForUser: vi.fn() }));
import { syncFeishuCustomersForUser } from "./feishuCustomerSync";
import { appRouter } from "./routers";

function caller(role: string | null, isActive = true) {
  return appRouter.createCaller({ user: role ? { id: 7, name: "测试人员", role, isActive } : null,
    req: { headers: {} }, res: {} } as unknown as TrpcContext);
}
beforeEach(() => vi.clearAllMocks());
describe("customer sync endpoint", () => {
  it("requires an active authenticated user", async () => {
    await expect(caller(null).customers.syncFeishu()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller("super_admin", false).customers.syncFeishu()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(syncFeishuCustomersForUser).not.toHaveBeenCalled();
  });
  it("uses server-owned account identity instead of accepting a target user or customer list", async () => {
    const result = { created: 2, existing: 1, skipped: 0, customers: 3, contracts: 4 };
    vi.mocked(syncFeishuCustomersForUser).mockResolvedValue(result);
    expect(await caller("user").customers.syncFeishu()).toEqual(result);
    expect(syncFeishuCustomersForUser).toHaveBeenCalledWith({ id: 7, name: "测试人员", role: "user", isActive: true });
  });
});
