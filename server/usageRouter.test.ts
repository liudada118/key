import { beforeEach, describe, expect, it, vi } from "vitest";
import { usageRouter } from "./usageRouter";
import type { TrpcContext } from "./_core/context";
import * as store from "./usageStore";
import { usageReadScope, usageOwnerCondition } from "./usageAccess";

vi.mock("./usageStore", () => ({
  listUsageCustomers: vi.fn(async () => []), getUsageOverview: vi.fn(async () => ({})),
  listUsageEvents: vi.fn(async () => ({ items: [], total: 0 })), getUsageEventContext: vi.fn(async () => []),
  getUsageAnalysisSummary: vi.fn(async () => ({})), listUsageFeatureUsage: vi.fn(async () => ({})),
  getUsageDashboard: vi.fn(async () => ({})), getUsageCollectionOutcome: vi.fn(async () => null),
  listUsageCustomerUsage: vi.fn(async () => ({})), listUsageSystems: vi.fn(async () => []),
}));
const filters = { from: "2026-09-01", to: "2026-09-24", environment: "production" as const };
const identity = { sourceId: 4, installationId: "249c3777-cff6-44e4-99ea-a812e302a992", eventId: "149c3777-cff6-44e4-99ea-a812e302a992" };
const collection = { sourceId: identity.sourceId, installationId: identity.installationId, collectionId: "synthetic-collection" };
const fullScope = { kind: "all" } as const;

function caller(role: string | null, isActive = true, setHeader = vi.fn()) {
  return usageRouter.createCaller({ user: role ? { id: 7, role, isActive } : null, res: { setHeader } } as unknown as TrpcContext);
}

describe("usage issuer-scoped access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a recognized active account on every query", async () => {
    for (const [role, active] of [[null, true], ["user", false], ["admin", false], ["super_admin", false], ["unknown", true]] as const) {
      const client = caller(role, active), code = role ? "FORBIDDEN" : "UNAUTHORIZED";
      await expect(client.customers()).rejects.toMatchObject({ code });
      await expect(client.overview(filters)).rejects.toMatchObject({ code });
      await expect(client.summary(filters)).rejects.toMatchObject({ code });
      await expect(client.dashboard(filters)).rejects.toMatchObject({ code });
      await expect(client.customerUsage({ filters })).rejects.toMatchObject({ code });
      await expect(client.featureUsage({ filters })).rejects.toMatchObject({ code });
      await expect(client.systems(filters)).rejects.toMatchObject({ code });
      await expect(client.events({ filters })).rejects.toMatchObject({ code });
      await expect(client.context(identity)).rejects.toMatchObject({ code });
      await expect(client.collectionOutcome(collection)).rejects.toMatchObject({ code });
    }
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(["user", "admin", "super_admin"])("derives every %s query scope from the session, never the filters", async role => {
    const setHeader = vi.fn(), client = caller(role, true, setHeader);
    const scope = role === "super_admin" ? fullScope : { kind: "issuer", issuerId: 7 };
    await client.customers();
    await client.overview(filters);
    await client.summary(filters);
    await client.dashboard(filters);
    await client.customerUsage({ filters });
    await client.featureUsage({ filters });
    await client.systems(filters);
    await client.events({ filters });
    await client.context(identity);
    await expect(client.collectionOutcome(collection)).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const fn of Object.values(store)) expect(vi.mocked(fn).mock.calls[0][0]).toEqual(scope);
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(setHeader).toHaveBeenCalledTimes(10);
  });

  it("does not reveal whether a foreign event or outcome exists", async () => {
    vi.mocked(store.getUsageEventContext).mockResolvedValueOnce(null);
    await expect(caller("user").context(identity)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("user").collectionOutcome(collection)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects attempts to supply an access scope or another issuer", async () => {
    const client = caller("user");
    await expect(client.summary({ ...filters, issuerId: 8 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.events({ filters, scope: { kind: "all" } } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.customerUsage({ filters, createdById: 8 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.context({ ...identity, scope: { kind: "all" } } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
  });

  it("fails closed when an issuer identity or required scope is missing", () => {
    for (const id of [0, -1, NaN, 1.5]) {
      expect(() => usageReadScope({ id, role: "user", isActive: true })).toThrow();
      expect(() => usageOwnerCondition({ kind: "issuer", issuerId: id })).toThrow();
    }
    expect(() => usageOwnerCondition(undefined as never)).toThrow();
    expect(usageOwnerCondition(fullScope)).toBeUndefined();
  });

  it("preserves the full customer/install/event scope and validates bounded dates", async () => {
    const client = caller("super_admin");
    await client.overview({ ...filters, customerKey: "customer:7", featureId: "foreground" });
    expect(store.getUsageOverview).toHaveBeenCalledWith(fullScope, { ...filters, customerKey: "customer:7", featureId: "foreground" });
    await client.context(identity);
    expect(store.getUsageEventContext).toHaveBeenCalledWith(fullScope, identity);
    await expect(client.overview({ ...filters, from: "2026-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.overview({ ...filters, from: "2026-02-31" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.overview({ ...filters, from: "2026-10-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.context({ sourceId: 4 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validates and preserves feature/customer drill-down, pagination and diagnostic scope", async () => {
    const client = caller("super_admin");
    const scoped = { ...filters, featureId: "collection", identityScope: "company" as const,
      customerKey: "customer:7", systemType: "custom.0123456789abcdef" };
    await client.featureUsage({ filters: scoped, page: 2, sort: "usage", category: "diagnostic" });
    expect(store.listUsageFeatureUsage).toHaveBeenCalledWith(fullScope, { filters: scoped, page: 2, sort: "usage", category: "diagnostic" });
    await client.customerUsage({ filters: scoped });
    expect(store.listUsageCustomerUsage).toHaveBeenCalledWith(fullScope, { filters: scoped, page: 1, sort: "recent" });
    await client.summary(scoped); expect(store.getUsageAnalysisSummary).toHaveBeenCalledWith(fullScope, scoped);
    await client.dashboard(scoped); expect(store.getUsageDashboard).toHaveBeenCalledWith(fullScope, scoped);
    await client.systems(scoped); expect(store.listUsageSystems).toHaveBeenCalledWith(fullScope, scoped);
    await expect(client.featureUsage({ filters: scoped, page: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.customerUsage({ filters: { ...filters, identityScope: "invalid" } } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.summary({ ...scoped, systemType: "invalid system" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.dashboard({ ...scoped, from: "2025-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
