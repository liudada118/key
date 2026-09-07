import { describe, expect, it } from "vitest";
import {
  dedupeFeishuContractsByNo,
  filterFeishuContractsBySubmitter,
  getFeishuContractSubmitterScope,
  type FeishuContract,
} from "./feishuContracts";

function makeContract(
  id: number,
  contractNo: string,
  submitter: string | null
): FeishuContract {
  const now = new Date("2026-07-30T00:00:00.000Z");
  return {
    id,
    contractNo,
    title: contractNo,
    customerId: null,
    customerName: null,
    businessUnit: null,
    submitter,
    signDate: null,
    startDate: null,
    endDate: null,
    totalKeys: 0,
    usedKeys: 0,
    status: "ACTIVE",
    remark: null,
    createdById: 0,
    createdByName: "飞书多维表格",
    createdAt: now,
    updatedAt: now,
    keyCount: 0,
    generatedKeyCount: 0,
    source: "feishu",
  };
}

describe("getFeishuContractSubmitterScope", () => {
  it("scopes child accounts by their trimmed display name", () => {
    expect(
      getFeishuContractSubmitterScope({ role: "user", name: "  覃娅琦  " })
    ).toBe("覃娅琦");
  });

  it("returns null when a child account has no display name", () => {
    expect(getFeishuContractSubmitterScope({ role: "user", name: " " })).toBeNull();
  });

  it("does not scope administrators", () => {
    expect(
      getFeishuContractSubmitterScope({ role: "admin", name: "覃娅琦" })
    ).toBeUndefined();
    expect(
      getFeishuContractSubmitterScope({ role: "super_admin", name: "覃娅琦" })
    ).toBeUndefined();
  });
});

describe("filterFeishuContractsBySubmitter", () => {
  const contracts = [
    makeContract(-1, "HT-001", "覃娅琦"),
    makeContract(-2, "HT-002", "戴成程"),
    makeContract(-3, "HT-003", "覃娅琦"),
    makeContract(-4, "HT-004", "Qin   Ya Qi"),
  ];

  it("returns every contract submitted by the same person", () => {
    expect(
      filterFeishuContractsBySubmitter(contracts, "覃娅琦").map(
        (item) => item.contractNo
      )
    ).toEqual(["HT-001", "HT-003"]);
  });

  it("normalizes surrounding whitespace, repeated spaces, and letter case", () => {
    expect(
      filterFeishuContractsBySubmitter(contracts, "  QIN YA QI  ").map(
        (item) => item.contractNo
      )
    ).toEqual(["HT-004"]);
  });

  it("returns no contracts for an empty submitter name", () => {
    expect(filterFeishuContractsBySubmitter(contracts, " ")).toEqual([]);
  });
});

describe("dedupeFeishuContractsByNo", () => {
  it("deduplicates contract numbers after whitespace and case normalization", () => {
    const first = makeContract(-1, " HT-001 ", "覃娅琦");
    first.customerName = "上海示例公司";
    const duplicate = makeContract(-2, "ht-001", "覃娅琦");
    duplicate.businessUnit = "华东事业部";

    const result = dedupeFeishuContractsByNo([
      first,
      duplicate,
      makeContract(-3, "HT-002", "戴成程"),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: -1,
      contractNo: "HT-001",
      customerName: "上海示例公司",
      businessUnit: "华东事业部",
    });
  });

  it("keeps the active status and largest authorization count", () => {
    const inactive = makeContract(-1, "HT-003", null);
    inactive.status = "EXPIRED";
    inactive.totalKeys = 2;
    const active = makeContract(-2, "HT-003", "覃娅琦");
    active.totalKeys = 8;

    const [result] = dedupeFeishuContractsByNo([inactive, active]);

    expect(result.status).toBe("ACTIVE");
    expect(result.totalKeys).toBe(8);
    expect(result.submitter).toBe("覃娅琦");
  });
});
