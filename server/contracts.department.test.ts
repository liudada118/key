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
    expect(getFeishuContracts).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: undefined, submitter: "提交人甲" });
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
});
