import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { FeishuContract } from "./feishuContracts";
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(),
  getUserAndSubordinateIds: vi.fn(async () => [7]), getCustomerDashboardRecords: vi.fn(),
  getGeneratedKeyCountsByContractNos: vi.fn(), getCustomers: vi.fn(),
}));
vi.mock("./feishuContractDirectory", async original => ({ ...await original<typeof import("./feishuContractDirectory")>(), readVisibleContractsWithDepartments: vi.fn() }));
vi.mock("./feishuCustomerMetadata", async original => ({ ...await original<typeof import("./feishuCustomerMetadata")>(), enrichCustomersWithContractMetadata: vi.fn() }));
import { getCustomerDashboardRecords, getCustomers, getGeneratedKeyCountsByContractNos, getUserAndSubordinateIds } from "./db";
import { readVisibleContractsWithDepartments } from "./feishuContractDirectory";
import { enrichCustomersWithContractMetadata } from "./feishuCustomerMetadata";
import { summarizeContracts, summarizeCustomers } from "./managementDashboard";
import { appRouter } from "./routers";

const base = { id: 1, name: "客户甲", isActive: true, departmentNames: ["事业部甲", "事业部乙"], initiatorNames: ["甲"], contractCount: 2, unmatchedDepartmentCount: 0, missingInitiatorCount: 0 };
const rows = [base, { ...base, id: 2, name: "客户乙", isActive: false, departmentNames: [], contractCount: 0 },
  { ...base, id: 3, name: "客户丙", departmentNames: ["事业部甲"], unmatchedDepartmentCount: 1 }];
const contracts = Array.from({ length: 43 }, (_, i) => ({ id: -i - 1, contractNo: `HT-${i}`, status: i % 3 ? "ACTIVE" : "DRAFT", businessUnit: i % 2 ? "事业部甲" : null } as FeishuContract));
function caller(role: string | null = "user", isActive = true) {
  return appRouter.createCaller({ user: role ? { id: 7, role, name: "甲", isActive } : null,
    req: { headers: {} }, res: { setHeader: vi.fn() } } as unknown as TrpcContext);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCustomerDashboardRecords).mockResolvedValue(rows);
  vi.mocked(enrichCustomersWithContractMetadata).mockResolvedValue({ items: rows, contractMetadataError: null });
  vi.mocked(readVisibleContractsWithDepartments).mockResolvedValue(contracts);
  vi.mocked(getGeneratedKeyCountsByContractNos).mockResolvedValue({ "HT-1": 2, "HT-42": 1 });
  vi.mocked(getCustomers).mockResolvedValue({ items: [], total: 0 });
});
describe("full-scope management dashboards", () => {
  it("deduplicates customer membership per department and separates unmatched from no-contract", () => {
    expect(summarizeCustomers({ items: rows, contractMetadataError: null })).toMatchObject({ total: 3, active: 2,
      withContracts: 2, withoutContracts: 1, unmatched: 1,
      departments: [{ name: "事业部甲", value: 2 }, { name: "事业部乙", value: 1 }] });
  });
  it("does not present unavailable contract coverage as zero", () => {
    expect(summarizeCustomers({ items: [], contractMetadataError: "暂不可用" })).toMatchObject({ total: 0, withContracts: null, withoutContracts: null, unmatched: null });
  });
  it("counts the complete contract directory and only active unissued contracts as waiting", () => {
    const result = summarizeContracts(contracts, { "HT-1": 2, "HT-42": 1 });
    expect(result).toMatchObject({ total: 43, active: 28, issued: 2, waiting: 27, unmatched: 22,
      statuses: { ACTIVE: 28, DRAFT: 15, EXPIRED: 0, TERMINATED: 0 } });
    expect(result.departments.reduce((sum, row) => sum + row.value, 0)).toBe(43);
  });
  it("uses ownership and search before customer aggregation and exposes only summary data", async () => {
    const result = await caller().customers.dashboard({ search: "客户" });
    expect(getUserAndSubordinateIds).toHaveBeenCalledWith(7, "user");
    expect(getCustomerDashboardRecords).toHaveBeenCalledWith([7], "客户");
    expect(enrichCustomersWithContractMetadata).toHaveBeenCalledWith(rows, expect.objectContaining({ id: 7, role: "user" }));
    expect(result.total).toBe(3);
    expect(result).not.toHaveProperty("items");
    expect(JSON.stringify(result)).not.toContain("客户丙");
  });
  it("filters customer department membership without counting only a list page", async () => {
    const result = await caller().customers.dashboard({ businessUnit: "事业部乙" });
    expect(result).toMatchObject({ total: 1, withContracts: 1 });
  });
  it("filters customer coverage before DB pagination and keeps active/search constraints", async () => {
    await caller().customers.list({ coverage: "unmatched", isActive: true, page: 2, pageSize: 1, search: "客户" });
    expect(getCustomers).toHaveBeenCalledWith(expect.objectContaining({ userIds: [7], customerIds: [3], isActive: true, page: 2, pageSize: 1, search: "客户" }));
  });
  it("fails closed for a coverage or department drill-down when metadata is unavailable", async () => {
    vi.mocked(enrichCustomersWithContractMetadata).mockResolvedValue({ items: rows, contractMetadataError: "private upstream token" });
    await expect(caller().customers.dashboard({ businessUnit: "事业部甲" })).rejects.toMatchObject({ message: "客户看板读取失败，请检查数据来源后重试" });
    await expect(caller().customers.list({ coverage: "without" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getCustomers).not.toHaveBeenCalled();
  });
  it("reads full visible contract scope and supports an unknown department as empty", async () => {
    expect(await caller().contracts.dashboard({})).toMatchObject({ total: 43, issued: 2 });
    expect(readVisibleContractsWithDepartments).toHaveBeenCalledWith(expect.objectContaining({ id: 7, role: "user" }));
    expect(getGeneratedKeyCountsByContractNos).toHaveBeenCalledWith(contracts.map(row => row.contractNo));
    expect(await caller().contracts.dashboard({ businessUnit: "不存在" })).toMatchObject({ total: 0, issued: 0 });
  });
  it("filters contract issuance before total and pagination, including later-page keys", async () => {
    const result = await caller().contracts.list({ source: "feishu", issuance: "with", page: 2, pageSize: 1 });
    expect(result).toMatchObject({ total: 2, items: [{ contractNo: "HT-42", generatedKeyCount: 1 }] });
    await expect(caller().contracts.list({ source: "db", issuance: "with" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("rejects anonymous/disabled callers and sanitized source errors", async () => {
    for (const client of [caller(null), caller("user", false)]) {
      await expect(client.customers.dashboard({})).rejects.toBeDefined();
      await expect(client.contracts.dashboard({})).rejects.toBeDefined();
    }
    expect(getCustomerDashboardRecords).not.toHaveBeenCalled();
    vi.mocked(readVisibleContractsWithDepartments).mockRejectedValue(new Error("secret"));
    await expect(caller().contracts.dashboard({})).rejects.toMatchObject({ message: "合同看板读取失败，请检查飞书来源和人员部门配置" });
  });
});
