import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectFeishuCustomerNames, syncFeishuCustomersForUser } from "./feishuCustomerSync";
import { getFeishuContracts } from "./feishuContracts";

vi.mock("./db", () => ({ getDb: vi.fn(), getUserAndSubordinateIds: vi.fn() }));
vi.mock("./feishuContracts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./feishuContracts")>(), getFeishuContracts: vi.fn(),
}));

describe("Feishu customer candidate collection", () => {
  it("normalizes customer identity without changing the first display name", () => {
    const result = collectFeishuCustomerNames([{ customerName: "  ＡＣＭＥ  " }, { customerName: "acme" }, { customerName: "Other" }]);
    expect(Array.from(result.names.values())).toEqual(["ＡＣＭＥ", "Other"]);
    expect(result.skipped).toBe(0);
  });
  it("skips missing and overlong names without truncating them into another customer", () => {
    const result = collectFeishuCustomerNames([{ customerName: null }, { customerName: " " }, { customerName: "x".repeat(257) }]);
    expect(result.names.size).toBe(0);
    expect(result.skipped).toBe(3);
  });
});

describe("Feishu customer source access", () => {
  const user = { id: 1, name: " ", role: "user" as const, isActive: true };
  beforeEach(() => vi.clearAllMocks());
  it("rejects disabled accounts and child accounts without a matching display name", async () => {
    await expect(syncFeishuCustomersForUser({ ...user, isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(syncFeishuCustomersForUser(user)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getFeishuContracts).not.toHaveBeenCalled();
  });
  it("does not start an import when Feishu is unconfigured", async () => {
    vi.mocked(getFeishuContracts).mockResolvedValue({ items: [], total: 0, source: "feishu", error: "未配置飞书合同表" });
    await expect(syncFeishuCustomersForUser({ ...user, name: "提交人甲" })).rejects.toThrow("未配置飞书合同表");
    expect(getFeishuContracts).toHaveBeenCalledWith({ page: 1, pageSize: 1000, submitter: "提交人甲" });
  });
});
