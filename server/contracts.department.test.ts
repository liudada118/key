import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  getContractSubmitterDepartments: vi.fn(),
  getGeneratedKeyCountsByContractNos: vi.fn(),
}));
vi.mock("./feishuContracts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./feishuContracts")>(),
  getFeishuContracts: vi.fn(),
}));

import { getContractSubmitterDepartments, getGeneratedKeyCountsByContractNos } from "./db";
import { getFeishuContracts, type FeishuContract } from "./feishuContracts";
import { appRouter } from "./routers";

function caller(role: string | null, name = "提交人甲", isActive = true) {
  return appRouter.createCaller({
    user: role ? { id: 7, role, name, isActive } : null,
    req: { headers: {} }, res: {},
  } as unknown as TrpcContext);
}

const contract: FeishuContract = {
  id: -1, contractNo: "HT-001", title: "HT-001", customerId: null,
  customerName: "示例客户", businessUnit: null, submitter: "提交人甲",
  signDate: null, startDate: null, endDate: null, totalKeys: 0, usedKeys: 0,
  status: "ACTIVE", remark: null, createdById: 0, createdByName: "飞书多维表格",
  createdAt: new Date("2026-10-16T00:00:00Z"), updatedAt: new Date("2026-10-16T00:00:00Z"),
  keyCount: 0, generatedKeyCount: 0, source: "feishu",
};
const input = { source: "feishu" as const, page: 1, pageSize: 20 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFeishuContracts).mockResolvedValue({ items: [contract], total: 1, source: "feishu" });
  vi.mocked(getContractSubmitterDepartments).mockResolvedValue([{ name: "提交人甲", departmentName: "精密事业部" }]);
  vi.mocked(getGeneratedKeyCountsByContractNos).mockResolvedValue({ "HT-001": 3 });
});

describe("contract department enrichment", () => {
  it("enriches visible contracts without changing IDs, counts or the cached source", async () => {
    const result = await caller("super_admin").contracts.list(input);
    expect(result).toMatchObject({ total: 1, items: [{ id: -1, contractNo: "HT-001", businessUnit: "精密事业部", generatedKeyCount: 3 }] });
    expect(contract.businessUnit).toBeNull();
    expect(getGeneratedKeyCountsByContractNos).toHaveBeenCalledWith(["HT-001"]);
    expect(getContractSubmitterDepartments).toHaveBeenCalledTimes(1);
  });

  it("preserves child-account submitter scoping before enrichment", async () => {
    await caller("user").contracts.list(input);
    expect(getFeishuContracts).toHaveBeenCalledWith({ page: 1, pageSize: 1000, submitter: "提交人甲" });
  });

  it("requires an active authenticated account", async () => {
    await expect(caller(null).contracts.list(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller("user", "提交人甲", false).contracts.list(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getContractSubmitterDepartments).not.toHaveBeenCalled();
  });

  it("does not load department data for a child account without a display name", async () => {
    const result = await caller("user", " ").contracts.list(input);
    expect(result).toMatchObject({ total: 0, items: [], error: expect.any(String) });
    expect(getContractSubmitterDepartments).not.toHaveBeenCalled();
    expect(getFeishuContracts).not.toHaveBeenCalled();
  });

  it("does not look up departments when every contract already contains a business unit", async () => {
    vi.mocked(getFeishuContracts).mockResolvedValue({ items: [{ ...contract, businessUnit: "合同事业部" }], total: 1, source: "feishu" });
    expect((await caller("admin").contracts.list(input)).items[0]).toMatchObject({ businessUnit: "合同事业部" });
    expect(getContractSubmitterDepartments).not.toHaveBeenCalled();
  });

  it("does not look up departments for an empty page", async () => {
    vi.mocked(getFeishuContracts).mockResolvedValue({ items: [], total: 0, source: "feishu" });
    expect((await caller("admin").contracts.list(input)).items).toEqual([]);
    expect(getContractSubmitterDepartments).not.toHaveBeenCalled();
  });

  it("reflects department changes even when Feishu contracts are cached", async () => {
    expect((await caller("admin").contracts.list(input)).items[0]).toMatchObject({ businessUnit: "精密事业部" });
    vi.mocked(getContractSubmitterDepartments).mockResolvedValue([{ name: "提交人甲", departmentName: "康养事业部" }]);
    expect((await caller("admin").contracts.list(input)).items[0]).toMatchObject({ businessUnit: "康养事业部" });
    expect(contract.businessUnit).toBeNull();
  });

  it("filters resolved departments and status before pagination, total and key-count lookup", async () => {
    const items = Array.from({ length: 45 }, (_, i) => ({ ...contract, id: -i - 1, contractNo: `HT-${i}`,
      businessUnit: i % 2 ? "康养事业部" : null, status: i === 0 ? "TERMINATED" as const : "ACTIVE" as const }));
    vi.mocked(getFeishuContracts).mockResolvedValue({ items, total: items.length, source: "feishu" });
    const result = await caller("super_admin").contracts.list({ ...input, page: 2, pageSize: 10, businessUnit: "精密事业部", status: "ACTIVE" });
    expect(result.total).toBe(22);
    expect(result.items.map(item => item.contractNo)).toEqual(Array.from({ length: 10 }, (_, i) => `HT-${22 + i * 2}`));
    expect(result.items.every(item => "businessUnit" in item && item.businessUnit === "精密事业部")).toBe(true);
    expect(getGeneratedKeyCountsByContractNos).toHaveBeenCalledWith(result.items.map(item => item.contractNo));
  });

  it("returns no matches for an unknown department without falling back to all contracts", async () => {
    expect(await caller("super_admin").contracts.list({ ...input, businessUnit: "不存在" })).toMatchObject({ total: 0, items: [] });
  });

  it("offers distinct departments across all visible contract pages, not only the current page", async () => {
    vi.mocked(getFeishuContracts)
      .mockResolvedValueOnce({ items: Array.from({ length: 1000 }, () => contract), total: 1001, source: "feishu" })
      .mockResolvedValueOnce({ items: [{ ...contract, businessUnit: "康养事业部" }], total: 1001, source: "feishu" });
    expect((await caller("super_admin").contracts.businessUnits()).sort()).toEqual(["康养事业部", "精密事业部"].sort());
    expect(getFeishuContracts).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 1000 });
  });

  it("does not expose departments from other submitters to a subaccount", async () => {
    vi.mocked(getFeishuContracts).mockImplementation(async opts => ({ source: "feishu", total: 1,
      items: [{ ...contract, businessUnit: "精密事业部" }, { ...contract, submitter: "其他人", businessUnit: "其他事业部" }]
        .filter(item => item.submitter === opts?.submitter) }));
    expect(await caller("user").contracts.businessUnits()).toEqual(["精密事业部"]);
    expect(getFeishuContracts).toHaveBeenCalledWith({ page: 1, pageSize: 1000, submitter: "提交人甲" });
  });

  it("fails closed for incomplete options and nameless or inactive accounts", async () => {
    await expect(caller(null).contracts.businessUnits()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller("user", "提交人甲", false).contracts.businessUnits()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user", " ").contracts.businessUnits()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getFeishuContracts).not.toHaveBeenCalled();
    vi.mocked(getFeishuContracts).mockResolvedValue({ items: [], total: 2, source: "feishu" });
    await expect(caller("super_admin").contracts.businessUnits()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a department filter for the legacy database source rather than ignoring it", async () => {
    await expect(caller("super_admin").contracts.list({ ...input, source: "db", businessUnit: "精密事业部" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
