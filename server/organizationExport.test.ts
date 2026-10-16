import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(), createAuditLog: vi.fn() }));
vi.mock("./organizationExport", async original => ({ ...await original<typeof import("./organizationExport")>(), getOrganizationExport: vi.fn() }));
import { createAuditLog } from "./db";
import { buildOrganizationExport, getOrganizationExport } from "./organizationExport";
import { appRouter } from "./routers";

const accounts = [
  { id: 1, username: "manager", name: "部门管理员", role: "admin" as const, isActive: true, managedGroups: "精密", departmentId: 5, createdById: null,
    password: "private-hash", email: "private-email", phone: "private-phone", remark: "private-remark", token: "private-token" },
  { id: 2, username: "member", name: "发起人甲", role: "user" as const, isActive: false, managedGroups: null, departmentId: 5, createdById: 1 },
];
const departments = [{ id: 5, name: "精密事业部", sensorGroup: "精密", managerId: 1 }];
const snapshot = buildOrganizationExport(accounts, departments, new Date("2026-10-16T00:00:00Z"));

function context(role: string | null = "super_admin", isActive = true) {
  const setHeader = vi.fn();
  return { caller: appRouter.createCaller({ user: role ? { id: 9, username: "admin", name: "管理员", role, isActive } : null,
    req: { headers: {}, socket: {} }, res: { setHeader } } as unknown as TrpcContext), setHeader };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrganizationExport).mockResolvedValue(snapshot);
  vi.mocked(createAuditLog).mockResolvedValue(undefined);
});

describe("organization export projection", () => {
  it("preserves department membership, creator and manager relations without relying on destination IDs", () => {
    expect(snapshot).toMatchObject({ format: "key-manager-organization", version: 1, exportedAt: "2026-10-16T00:00:00.000Z",
      counts: { accounts: 2, departments: 1 },
      accounts: [{ sourceId: 1, departmentName: "精密事业部", createdByUsername: null },
        { sourceId: 2, departmentName: "精密事业部", createdByUsername: "manager", isActive: false }],
      departments: [{ sourceId: 5, name: "精密事业部", managerUsername: "manager" }] });
  });
  it("uses an explicit allowlist even if input rows accidentally contain credentials or private contact details", () => {
    const json = JSON.stringify(snapshot);
    for (const value of ["private-hash", "private-email", "private-phone", "private-remark", "private-token"]) expect(json).not.toContain(value);
    expect(Object.keys(snapshot.accounts[0]).sort()).toEqual(["sourceId", "username", "name", "role", "isActive", "managedGroups", "departmentName", "createdByUsername"].sort());
  });
  it("exports all records, including inactive and unassigned accounts, not a UI page", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ ...accounts[1], id: i + 1, username: `user${i}`, departmentId: null, createdById: null }));
    const result = buildOrganizationExport(rows, []);
    expect(result.accounts).toHaveLength(120);
    expect(result.counts).toEqual({ accounts: 120, departments: 0 });
    expect(result.accounts.every(account => account.departmentName === null && !account.isActive)).toBe(true);
  });
  it("retains empty exports and treats missing historical references as null", () => {
    expect(buildOrganizationExport([], []).counts).toEqual({ accounts: 0, departments: 0 });
    expect(buildOrganizationExport([accounts[1]], [{ ...departments[0], managerId: 999 }])).toMatchObject({
      accounts: [{ createdByUsername: null }], departments: [{ managerUsername: null }],
    });
  });
});

describe("organization export endpoint", () => {
  it.each([null, "user", "admin"])("rejects unauthorized role %s before reading organization data", async role => {
    await expect(context(role).caller.accounts.exportOrganization()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOrganizationExport).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });
  it("rejects a disabled super administrator", async () => {
    await expect(context("super_admin", false).caller.accounts.exportOrganization()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getOrganizationExport).not.toHaveBeenCalled();
  });
  it("disables response caching and records only actor and counts in audit", async () => {
    const { caller, setHeader } = context();
    expect(await caller.accounts.exportOrganization()).toEqual(snapshot);
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: 9, action: "EXPORT", resourceType: "organization" }));
    expect(JSON.stringify(vi.mocked(createAuditLog).mock.calls)).not.toContain("member");
  });
  it("does not return a partial export or sensitive exception details when storage fails", async () => {
    vi.mocked(getOrganizationExport).mockRejectedValueOnce(new Error("database password secret"));
    await expect(context().caller.accounts.exportOrganization()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "账号部门导出失败，请重试" });
    expect(createAuditLog).not.toHaveBeenCalled();
  });
  it("does not return the export if audit persistence fails", async () => {
    vi.mocked(createAuditLog).mockRejectedValueOnce(new Error("audit failed"));
    await expect(context().caller.accounts.exportOrganization()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
