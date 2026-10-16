import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dedupeFeishuContractsByNo,
  filterFeishuContractsBySubmitter,
  fillFeishuContractBusinessUnits,
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

describe("fillFeishuContractBusinessUnits", () => {
  it("matches the submitter's normalized display name to the system department", () => {
    const contracts = [makeContract(-1, "HT-001", "  ＱＩＮ   Ya Qi  ")];
    const result = fillFeishuContractBusinessUnits(contracts, [
      { name: "Qin Ya Qi", departmentName: "  精密事业部  " },
    ]);
    expect(result[0]).toMatchObject({ id: -1, contractNo: "HT-001", businessUnit: "精密事业部" });
    expect(contracts[0].businessUnit).toBeNull();
  });

  it("preserves an explicit Feishu business unit", () => {
    const contract = { ...makeContract(-1, "HT-001", "提交人甲"), businessUnit: "合同事业部" };
    const result = fillFeishuContractBusinessUnits([contract], [
      { name: "提交人甲", departmentName: "人员事业部" },
    ]);
    expect(result[0].businessUnit).toBe("合同事业部");
  });

  it("leaves absent names, unknown accounts and unassigned departments empty", () => {
    const contracts = [
      makeContract(-1, "HT-001", null),
      makeContract(-2, "HT-002", "未匹配的人"),
      makeContract(-3, "HT-003", "未分配部门的人"),
      makeContract(-4, "HT-004", "提交人"),
    ];
    const result = fillFeishuContractBusinessUnits(contracts, [
      { name: null, departmentName: "不应匹配" },
      { name: "未分配部门的人", departmentName: null },
      { name: "提交人甲", departmentName: "精密事业部" },
    ]);
    expect(result).toHaveLength(4);
    expect(result.every(item => item.businessUnit === null)).toBe(true);
  });

  it("allows identical names assigned to the same department", () => {
    const result = fillFeishuContractBusinessUnits([makeContract(-1, "HT-001", "提交人甲")], [
      { name: "提交人甲", departmentName: "精密事业部" },
      { name: " 提交人甲 ", departmentName: "精密事业部" },
    ]);
    expect(result[0].businessUnit).toBe("精密事业部");
  });

  it("does not choose between conflicting same-name accounts or heal a conflict later", () => {
    const result = fillFeishuContractBusinessUnits([makeContract(-1, "HT-001", "提交人甲")], [
      { name: "提交人甲", departmentName: "精密事业部" },
      { name: "提交人甲", departmentName: "康养事业部" },
      { name: "提交人甲", departmentName: "精密事业部" },
    ]);
    expect(result[0].businessUnit).toBeNull();
  });

  it("does not resolve same-name accounts when one has no department", () => {
    for (const accounts of [
      [{ name: "提交人甲", departmentName: null }, { name: "提交人甲", departmentName: "精密事业部" }],
      [{ name: "提交人甲", departmentName: "精密事业部" }, { name: "提交人甲", departmentName: null }],
    ]) {
      expect(fillFeishuContractBusinessUnits([makeContract(-1, "HT-001", "提交人甲")], accounts)[0].businessUnit).toBeNull();
    }
  });
});

describe("Feishu contract sources", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const contractRecord = {
    record_id: "recTest",
    fields: { 合同编号: "HT-001", 客户名称: "示例客户", 事业部: "测试事业部", 提交人: [{ name: "测试提交人" }] },
  };

  function reply(body: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  }

  function auth() {
    reply({ code: 0, tenant_access_token: "test-access-token", expire: 7200 });
  }

  function records() {
    reply({ code: 0, data: { items: [contractRecord], has_more: false } });
  }

  function requestedUrl(index: number) {
    return new URL(String(fetchMock.mock.calls[index][0]));
  }

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    for (const key of [
      "FEISHU_CONTRACT_BASE_APP_TOKEN", "FEISHU_CONTRACT_BASE_URL",
      "FEISHU_CONTRACT_SPREADSHEET_TOKEN", "FEISHU_CONTRACT_SPREADSHEET_URL",
      "FEISHU_CONTRACT_TABLE_ID", "FEISHU_CONTRACT_BASE_TABLE_ID",
      "FEISHU_CONTRACT_VIEW_ID", "FEISHU_CONTRACT_RANGE", "FEISHU_CONTRACT_SHEET_ID",
      "FEISHU_CONTRACT_CACHE_TTL_MS",
    ]) vi.stubEnv(key, "");
    vi.stubEnv("FEISHU_CONTRACT_CACHE_TTL_MS", "300000");
    vi.stubEnv("FEISHU_CONTRACTS_ENABLED", "true");
    vi.stubEnv("FEISHU_APP_ID", "test-app");
    vi.stubEnv("FEISHU_APP_SECRET", "test-secret");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps original base links and first-table discovery working", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/base/baseTest");
    auth();
    reply({ code: 0, data: { items: [{ table_id: "tblFirst" }] } });
    records();
    const { getFeishuContracts } = await import("./feishuContracts");
    const result = await getFeishuContracts();
    expect(result.total).toBe(1);
    expect(requestedUrl(1).pathname).toBe("/open-apis/bitable/v1/apps/baseTest/tables");
    expect(requestedUrl(2).pathname).toContain("/tables/tblFirst/records");
    expect(result.items[0]).toMatchObject({ contractNo: "HT-001", customerName: "示例客户", businessUnit: "测试事业部", submitter: "测试提交人" });
  });

  it("uses the URL's table and view, follows pagination and deduplicates contracts", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/base/baseTest?table=tblUrl&view=vewUrl");
    auth();
    reply({ code: 0, data: { items: [contractRecord], has_more: true, page_token: "next-page" } });
    records();
    const { getFeishuContracts } = await import("./feishuContracts");
    expect((await getFeishuContracts()).total).toBe(1);
    expect(requestedUrl(1).pathname).toContain("/tables/tblUrl/records");
    expect(requestedUrl(1).searchParams.get("view_id")).toBe("vewUrl");
    expect(requestedUrl(2).searchParams.get("page_token")).toBe("next-page");
    expect(requestedUrl(2).searchParams.get("view_id")).toBe("vewUrl");
  });

  it("maps sales approval contract fields and scopes them by the initiator name", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/wiki/wikiSales");
    vi.stubEnv("FEISHU_CONTRACT_TABLE_ID", "tblSales");
    auth();
    reply({ code: 0, data: { node: { obj_type: "bitable", obj_token: "baseSales" } } });
    reply({ code: 0, data: { items: [
      { record_id: "recSales1", fields: { 录入合同编号: "HT-SALES", 客户名称: "示例客户", 发起人: [{ id: "ouTest", name: "测试提交人" }], 申请编号: "FLOW-001" } },
      { record_id: "recSales2", fields: { 录入合同编号: " HT-SALES ", 发起人: [{ name: "测试提交人" }] } },
      { record_id: "recOther", fields: { 录入合同编号: "HT-OTHER", 发起人: [{ name: "其他提交人" }] } },
      { record_id: "recNoContract", fields: { 申请编号: "FLOW-002", 发起人: [{ name: "测试提交人" }] } },
    ], has_more: false } });
    const { getFeishuContracts } = await import("./feishuContracts");
    const result = await getFeishuContracts({ submitter: "测试提交人" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ contractNo: "HT-SALES", customerName: "示例客户", submitter: "测试提交人", businessUnit: null });
    expect(requestedUrl(2).pathname).toContain("/tables/tblSales/records");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recognizes sales approval aliases in electronic sheet headers too", async () => {
    vi.stubEnv("FEISHU_CONTRACT_SPREADSHEET_TOKEN", "sheetSales");
    auth();
    reply({ code: 0, data: { valueRange: { values: [
      ["录入合同编号", "客户名称", "发起人"],
      ["HT-SALES", "示例客户", "测试提交人"],
    ] } } });
    const { getFeishuContracts } = await import("./feishuContracts");
    const result = await getFeishuContracts();
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ contractNo: "HT-SALES", customerName: "示例客户", submitter: "测试提交人" });
  });

  it("preserves explicit token, table and view overrides", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_APP_TOKEN", "baseOverride");
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/base/baseTest?table=tblUrl&view=vewUrl");
    vi.stubEnv("FEISHU_CONTRACT_TABLE_ID", "tblOverride");
    vi.stubEnv("FEISHU_CONTRACT_VIEW_ID", "vewOverride");
    auth();
    records();
    const { getFeishuContracts } = await import("./feishuContracts");
    await getFeishuContracts();
    expect(requestedUrl(1).pathname).toContain("/apps/baseOverride/tables/tblOverride/records");
    expect(requestedUrl(1).searchParams.get("view_id")).toBe("vewOverride");
  });

  it("uses explicit table and view overrides instead of URL query values", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/base/baseTest?table=tblUrl&view=vewUrl");
    vi.stubEnv("FEISHU_CONTRACT_BASE_TABLE_ID", "tblOverride");
    vi.stubEnv("FEISHU_CONTRACT_VIEW_ID", "vewOverride");
    auth();
    records();
    const { getFeishuContracts } = await import("./feishuContracts");
    await getFeishuContracts();
    expect(requestedUrl(1).pathname).toContain("/tables/tblOverride/records");
    expect(requestedUrl(1).searchParams.get("view_id")).toBe("vewOverride");
  });

  it.each([
    ["FEISHU_CONTRACT_SPREADSHEET_URL", "https://example.feishu.cn/sheets/sheetTest"],
    ["FEISHU_CONTRACT_SPREADSHEET_TOKEN", "sheetTest"],
    ["FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/sheets/sheetTest"],
    ["FEISHU_CONTRACT_SPREADSHEET_URL", "https://example.feishu.cn/?spreadsheetToken=sheetTest"],
  ])("routes %s=%s to the sheets API", async (key, value) => {
    vi.stubEnv(key, value);
    auth();
    reply({ code: 0, data: { valueRange: { values: [["合同编号", "提交人"], ["HT-SHEET", "测试提交人"]] } } });
    const { getFeishuContracts } = await import("./feishuContracts");
    expect((await getFeishuContracts()).items[0].contractNo).toBe("HT-SHEET");
    expect(requestedUrl(1).pathname).toContain("/sheets/v2/spreadsheets/sheetTest/values/");
  });

  it("still accepts a base URL in the legacy spreadsheet URL setting", async () => {
    vi.stubEnv("FEISHU_CONTRACT_SPREADSHEET_URL", "https://example.feishu.cn/base/baseTest?table=tblUrl");
    auth();
    records();
    const { getFeishuContracts } = await import("./feishuContracts");
    await getFeishuContracts();
    expect(requestedUrl(1).pathname).toContain("/bitable/v1/apps/baseTest/tables/tblUrl/records");
  });

  it("resolves wiki nodes to bitable tokens and reuses the contract cache", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/wiki/wikiTest?from=from_copylink&table=tblUrl&view=vewUrl");
    auth();
    reply({ code: 0, data: { node: { obj_type: "bitable", obj_token: "baseResolved" } } });
    records();
    const { getFeishuContracts, isFeishuContractsConfigured } = await import("./feishuContracts");
    expect(isFeishuContractsConfigured()).toBe(true);
    expect((await getFeishuContracts()).total).toBe(1);
    expect((await getFeishuContracts()).total).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestedUrl(1).pathname).toBe("/open-apis/wiki/v2/spaces/get_node");
    expect(requestedUrl(1).searchParams.get("token")).toBe("wikiTest");
    expect(requestedUrl(2).pathname).toContain("/apps/baseResolved/tables/tblUrl/records");
    expect(requestedUrl(2).searchParams.get("view_id")).toBe("vewUrl");
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ Authorization: "Bearer test-access-token" });
  });

  it("also resolves wiki nodes containing an electronic sheet", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/wiki/wikiTest");
    auth();
    reply({ code: 0, data: { node: { obj_type: "sheet", obj_token: "sheetResolved" } } });
    reply({ code: 0, data: { valueRange: { values: [["合同编号"], ["HT-SHEET"]] } } });
    const { getFeishuContracts } = await import("./feishuContracts");
    expect((await getFeishuContracts()).total).toBe(1);
    expect(requestedUrl(2).pathname).toContain("/sheets/v2/spreadsheets/sheetResolved/values/");
  });

  it("reports the missing wiki read scope for Feishu HTTP 400 errors", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/wiki/wikiTest");
    auth();
    reply({ code: 99991672, msg: "Access denied" }, 400);
    const { getFeishuContracts } = await import("./feishuContracts");
    await expect(getFeishuContracts()).rejects.toThrow("wiki:node:read");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ code: 131006, msg: "permission denied" }, "131006"],
    [{ code: 0, data: { node: { obj_type: "docx", obj_token: "docTest" } } }, "不是多维表格或电子表格"],
    [{ code: 0, data: { node: { obj_type: "bitable" } } }, "未返回原表标识"],
  ])("does not treat inaccessible or non-table wiki nodes as a contract table", async (response, message) => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/wiki/wikiTest");
    auth();
    reply(response);
    const { getFeishuContracts } = await import("./feishuContracts");
    await expect(getFeishuContracts()).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never returns the old table cache when the new wiki source is inaccessible", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/base/baseOld?table=tblOld");
    auth();
    records();
    const { getFeishuContracts } = await import("./feishuContracts");
    expect((await getFeishuContracts()).total).toBe(1);
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/wiki/wikiNew");
    reply({ code: 99991672, msg: "Access denied" }, 400);
    await expect(getFeishuContracts()).rejects.toThrow("wiki:node:read");
    expect(requestedUrl(2).searchParams.get("token")).toBe("wikiNew");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects share URLs before making API calls instead of using view as an app token", async () => {
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/share/base/view/shrTest");
    const { getFeishuContracts, isFeishuContractsConfigured } = await import("./feishuContracts");
    expect(isFeishuContractsConfigured()).toBe(false);
    await expect(getFeishuContracts()).rejects.toThrow("原表链接");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not make requests when contract synchronization is disabled", async () => {
    vi.stubEnv("FEISHU_CONTRACTS_ENABLED", "false");
    vi.stubEnv("FEISHU_CONTRACT_BASE_URL", "https://example.feishu.cn/wiki/wikiTest");
    const { getFeishuContracts } = await import("./feishuContracts");
    expect(await getFeishuContracts()).toMatchObject({ total: 0, items: [], error: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
