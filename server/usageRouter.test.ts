import { describe, expect, it, vi } from "vitest";
import { usageRouter } from "./usageRouter";
import type { TrpcContext } from "./_core/context";
import { getUsageEventContext, getUsageOverview } from "./usageStore";
vi.mock("./usageStore", () => ({
  listUsageCustomers: vi.fn(async () => []), getUsageOverview: vi.fn(async () => ({})),
  listUsageEvents: vi.fn(async () => ({ items: [], total: 0 })), getUsageEventContext: vi.fn(async () => []),
}));
const filters = { from: "2026-09-01", to: "2026-09-24", environment: "production" as const };
const identity = { sourceId: 4, installationId: "249c3777-cff6-44e4-99ea-a812e302a992", eventId: "149c3777-cff6-44e4-99ea-a812e302a992" };
/** Build a caller with an explicit role and active flag. */
function caller(role: string | null, isActive = true) {
  return usageRouter.createCaller({ user: role ? { id: 7, role, isActive } : null, res: { setHeader: vi.fn() } } as unknown as TrpcContext);
}
describe("usage administrator access", () => {
  it("restricts every query to active super administrators", async () => {
    for (const [role, active] of [[null, true], ["user", true], ["admin", true], ["super_admin", false]] as const) {
      const client = caller(role, active);
      await expect(client.customers()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.overview(filters)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.events({ filters })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.context(identity)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("preserves the full customer/install/event scope and validates bounded dates", async () => {
    const client = caller("super_admin");
    await client.overview({ ...filters, customerKey: "customer:7", featureId: "foreground" });
    expect(getUsageOverview).toHaveBeenCalledWith({ ...filters, customerKey: "customer:7", featureId: "foreground" });
    await client.context(identity);
    expect(getUsageEventContext).toHaveBeenCalledWith(identity);
    await expect(client.overview({ ...filters, from: "2026-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.overview({ ...filters, from: "2026-02-31" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.overview({ ...filters, from: "2026-10-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.context({ sourceId: 4 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
