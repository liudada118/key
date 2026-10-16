import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  getCustomers: vi.fn(),
  getCustomerNameRecords: vi.fn(),
  getUserAndSubordinateIds: vi.fn(),
  getContractSubmitterDepartments: vi.fn(),
}));
vi.mock("./feishuContracts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./feishuContracts")>(),
  getFeishuContracts: vi.fn(),
}));

import { getCustomers, getCustomerNameRecords, getUserAndSubordinateIds, getContractSubmitterDepartments } from "./db";
import { getFeishuContracts, type FeishuContract } from "./feishuContracts";
import { aggregateCustomerContractMetadata, enrichCustomersWithContractMetadata } from "./feishuCustomerMetadata";
import { appRouter } from "./routers";

const customer = {
  id: 12, name: "示例客户", createdById: 7, contactPerson: "客户联系人", phone: "123", email: null,
  address: null, remark: "保留客户备注", isActive: true, keyCount: 2,
  createdAt: new Date("2026-10-16T00:00:00Z"), updatedAt: new Date("2026-10-16T00:00:00Z"),
};
const contract: FeishuContract = {
  id: -1, contractNo: "HT-001", title: "HT-001", customerId: null,
  customerName: customer.name, businessUnit: null, submitter: "发起人甲",
  signDate: null, startDate: null, endDate: null, totalKeys: 0, usedKeys: 0,
  status: "ACTIVE", remark: null, createdById: 0, createdByName: "飞书多维表格",
  createdAt: customer.createdAt, updatedAt: customer.updatedAt,
  keyCount: 0, generatedKeyCount: 0, source: "feishu",
};
const input = { page: 2, pageSize: 15, search: "示例", isActive: true };

function caller(role: string | null = "super_admin", name = "发起人甲", isActive = true) {
  return appRouter.createCaller({ user: role ? { id: 7, name, role, isActive } : null,
    req: { headers: {} }, res: {} } as unknown as TrpcContext);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCustomers).mockResolvedValue({ items: [customer], total: 103 });
  vi.mocked(getCustomerNameRecords).mockResolvedValue([{ id: customer.id, name: customer.name }]);
  vi.mocked(getUserAndSubordinateIds).mockResolvedValue([7, 8]);
  vi.mocked(getFeishuContracts).mockResolvedValue({ items: [contract], total: 1, source: "feishu" });
  vi.mocked(getContractSubmitterDepartments).mockResolvedValue([{ name: "发起人甲", departmentName: "事业部甲" }]);
});

describe("customer contract metadata", () => {
  it("aggregates every distinct initiator and department without hiding unresolved contracts", () => {
    const source = [
      { customerName: "ＡＣＭＥ ", submitter: "人员甲", businessUnit: "事业部甲" },
      { customerName: "acme", submitter: "人员甲 ", businessUnit: "事业部甲" },
      { customerName: "Acme", submitter: "人员乙", businessUnit: "事业部乙" },
      { customerName: "ACME", submitter: null, businessUnit: null },
      { customerName: " ", submitter: "不应出现", businessUnit: "不应出现" },
    ];
    const original = structuredClone(source);
    const result = aggregateCustomerContractMetadata(source);
    expect(result.size).toBe(1);
    expect(result.get("acme")).toEqual({ departmentNames: ["事业部甲", "事业部乙"],
      initiatorNames: ["人员甲", "人员乙"], contractCount: 4, unmatchedDepartmentCount: 1, missingInitiatorCount: 1 });
    expect(source).toEqual(original);
  });

  it("enriches only the requested customer page and preserves profile data, total, scope and pagination", async () => {
    const result = await caller().customers.list(input);
    expect(getCustomers).toHaveBeenCalledWith({ ...input, userIds: [7, 8] });
    expect(getUserAndSubordinateIds).toHaveBeenCalledWith(7, "super_admin");
    expect(result).toMatchObject({ total: 103, contractMetadataError: null, items: [{ ...customer,
      departmentNames: ["事业部甲"], initiatorNames: ["发起人甲"], contractCount: 1 }] });
    expect(contract.businessUnit).toBeNull();
    expect(customer).not.toHaveProperty("departmentNames");
  });

  it("keeps subaccount contracts scoped by the display name, even for shared customers", async () => {
    vi.mocked(getFeishuContracts).mockImplementation(async (opts) => ({ items: [
      contract, { ...contract, submitter: "其他人员", businessUnit: "不可见部门" },
    ].filter(item => !opts?.submitter || item.submitter === opts.submitter), total: 1, source: "feishu" }));
    const result = await caller("user").customers.list(input);
    expect(getFeishuContracts).toHaveBeenCalledWith({ page: 1, pageSize: 1000, submitter: "发起人甲" });
    expect(result.items[0].initiatorNames).toEqual(["发起人甲"]);
    expect(result.items[0].departmentNames).toEqual(["事业部甲"]);
  });

  it("reads later pages and collects multiple initiators and departments for the same customer", async () => {
    vi.mocked(getFeishuContracts)
      .mockResolvedValueOnce({ items: Array.from({ length: 1000 }, () => ({ ...contract, businessUnit: "事业部甲" })), total: 1001, source: "feishu" })
      .mockResolvedValueOnce({ items: [{ ...contract, submitter: "发起人乙", businessUnit: "事业部乙" }], total: 1001, source: "feishu" });
    const result = await caller().customers.list(input);
    expect(getFeishuContracts).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 1000 });
    expect(result.items[0]).toMatchObject({ departmentNames: ["事业部甲", "事业部乙"], initiatorNames: ["发起人甲", "发起人乙"], contractCount: 1001 });
    expect(getContractSubmitterDepartments).not.toHaveBeenCalled();
  });

  it("does not mistake the customer creator for the initiator or department", async () => {
    vi.mocked(getFeishuContracts).mockResolvedValue({ items: [{ ...contract, customerName: "其他客户" }], total: 1, source: "feishu" });
    const result = await caller().customers.list(input);
    expect(result.items[0]).toMatchObject({ departmentNames: [], initiatorNames: [], contractCount: 0, unmatchedDepartmentCount: 0 });
    expect(getContractSubmitterDepartments).not.toHaveBeenCalled();
  });

  it("reports unresolved departments without suppressing real initiators", async () => {
    vi.mocked(getContractSubmitterDepartments).mockResolvedValue([]);
    const result = await caller().customers.list(input);
    expect(result.items[0]).toMatchObject({ departmentNames: [], initiatorNames: ["发起人甲"], unmatchedDepartmentCount: 1 });
  });

  it("reflects current system departments without mutating cached contracts", async () => {
    expect((await caller().customers.list(input)).items[0].departmentNames).toEqual(["事业部甲"]);
    vi.mocked(getContractSubmitterDepartments).mockResolvedValue([{ name: "发起人甲", departmentName: "事业部乙" }]);
    expect((await caller().customers.list(input)).items[0].departmentNames).toEqual(["事业部乙"]);
    expect(contract.businessUnit).toBeNull();
  });

  it("returns local profiles and a sanitized warning when Feishu fails", async () => {
    vi.mocked(getFeishuContracts).mockRejectedValue(new Error("secret upstream response"));
    const result = await caller().customers.list(input);
    expect(result).toMatchObject({ total: 103, items: [{ ...customer, initiatorNames: [], departmentNames: [] }],
      contractMetadataError: "合同资料暂不可用，部门和发起人读取失败" });
    expect(JSON.stringify(result)).not.toContain("secret upstream response");
    expect(getContractSubmitterDepartments).not.toHaveBeenCalled();
  });

  it("does not display partial metadata when a later contract page is incomplete", async () => {
    vi.mocked(getFeishuContracts)
      .mockResolvedValueOnce({ items: [contract], total: 2, source: "feishu" })
      .mockResolvedValueOnce({ items: [], total: 2, source: "feishu" });
    const result = await caller().customers.list(input);
    expect(result.contractMetadataError).toBeTruthy();
    expect(result.items[0].initiatorNames).toEqual([]);
  });

  it("keeps local profiles available when the source is unconfigured or department lookup fails", async () => {
    vi.mocked(getFeishuContracts).mockResolvedValueOnce({ items: [], total: 0, source: "feishu", error: "not configured" });
    expect((await caller().customers.list(input)).contractMetadataError).toBeTruthy();
    vi.mocked(getContractSubmitterDepartments).mockRejectedValueOnce(new Error("DB unavailable"));
    const result = await caller().customers.list(input);
    expect(result.items[0].id).toBe(customer.id);
    expect(result.contractMetadataError).toBeTruthy();
  });

  it("never broadens a nameless subaccount to all Feishu contracts", async () => {
    const result = await caller("user", " ").customers.list(input);
    expect(result.items[0].id).toBe(customer.id);
    expect(result.contractMetadataError).toContain("设置账号姓名");
    expect(getFeishuContracts).not.toHaveBeenCalled();
  });

  it("skips external reads for empty customer pages", async () => {
    expect(await enrichCustomersWithContractMetadata([], { role: "super_admin", name: "管理员" }))
      .toEqual({ items: [], contractMetadataError: null });
    expect(getFeishuContracts).not.toHaveBeenCalled();
  });

  it("requires an active authenticated user", async () => {
    await expect(caller(null).customers.list(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller("super_admin", "管理员", false).customers.list(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getCustomers).not.toHaveBeenCalled();
    expect(getFeishuContracts).not.toHaveBeenCalled();
  });

  it("applies department customer IDs before existing search and pagination, retaining every customer department", async () => {
    vi.mocked(getFeishuContracts).mockResolvedValue({ source: "feishu", total: 2, items: [contract,
      { ...contract, submitter: "发起人乙", businessUnit: "事业部乙" }] });
    const result = await caller().customers.list({ ...input, businessUnit: "事业部甲" });
    expect(getCustomerNameRecords).toHaveBeenCalledWith([7, 8]);
    expect(getCustomers).toHaveBeenCalledWith({ ...input, userIds: [7, 8], customerIds: [customer.id] });
    expect(result.items[0].departmentNames).toEqual(["事业部甲", "事业部乙"]);
    expect(getFeishuContracts).toHaveBeenCalledTimes(1);
    expect(getContractSubmitterDepartments).toHaveBeenCalledTimes(1);
  });

  it("matches imported normalized customer names for a department", async () => {
    vi.mocked(getCustomerNameRecords).mockResolvedValue([{ id: 19, name: "ＡＣＭＥ " }, { id: 20, name: "Other" }]);
    vi.mocked(getFeishuContracts).mockResolvedValue({ source: "feishu", total: 1,
      items: [{ ...contract, customerName: "acme", businessUnit: "事业部甲" }] });
    await caller().customers.list({ ...input, businessUnit: "事业部甲" });
    expect(getCustomers).toHaveBeenCalledWith(expect.objectContaining({ customerIds: [19], userIds: [7, 8] }));
  });

  it("passes an explicit empty ID set when the selected department has no matching customers", async () => {
    vi.mocked(getCustomers).mockResolvedValue({ items: [], total: 0 });
    expect(await caller().customers.list({ ...input, businessUnit: "不存在" })).toMatchObject({ total: 0, items: [] });
    expect(getCustomers).toHaveBeenCalledWith(expect.objectContaining({ customerIds: [] }));
  });

  it("leaves all and manually created customers unfiltered when no department is selected", async () => {
    await caller().customers.list(input);
    expect(getCustomerNameRecords).not.toHaveBeenCalled();
    expect(getCustomers).toHaveBeenCalledWith({ ...input, userIds: [7, 8] });
  });

  it("does not show unfiltered customers or partial matches when department resolution fails", async () => {
    vi.mocked(getFeishuContracts).mockRejectedValue(new Error("secret upstream response"));
    await expect(caller().customers.list({ ...input, businessUnit: "事业部甲" })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: "事业部筛选失败，请检查合同来源和人员部门配置后重试",
    });
    expect(getCustomers).not.toHaveBeenCalled();
    expect(getCustomerNameRecords).not.toHaveBeenCalled();
  });

  it("retains subaccount contract restrictions when filtering customers", async () => {
    await caller("user").customers.list({ ...input, businessUnit: "事业部甲" });
    expect(getFeishuContracts).toHaveBeenCalledWith({ page: 1, pageSize: 1000, submitter: "发起人甲" });
    expect(getUserAndSubordinateIds).toHaveBeenCalledWith(7, "user");
  });

  it.each([" ", "x".repeat(257)])("rejects invalid department filters", async businessUnit => {
    await expect(caller().customers.list({ ...input, businessUnit })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getCustomers).not.toHaveBeenCalled();
  });
});
