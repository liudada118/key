type FeishuTokenResponse = {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

type FeishuSheetResponse = {
  code: number;
  msg?: string;
  data?: {
    valueRange?: {
      values?: unknown[][];
    };
  };
};

type FeishuTableListResponse = {
  code: number;
  msg?: string;
  data?: {
    items?: { table_id: string; name?: string }[];
  };
};

type FeishuBitableRecord = {
  record_id: string;
  fields?: Record<string, unknown>;
};

type FeishuBitableRecordResponse = {
  code: number;
  msg?: string;
  data?: {
    items?: FeishuBitableRecord[];
    has_more?: boolean;
    page_token?: string;
  };
};

type ContractStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";

export type FeishuContract = {
  id: number;
  contractNo: string;
  title: string;
  customerId: null;
  customerName: string | null;
  businessUnit: string | null;
  submitter: string | null;
  signDate: string | null;
  startDate: string | null;
  endDate: string | null;
  totalKeys: number;
  usedKeys: number;
  status: ContractStatus;
  remark: string | null;
  createdById: number;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  keyCount: number;
  generatedKeyCount: number;
  source: "feishu";
};

export function getFeishuContractSubmitterScope(user: {
  role: string;
  name?: string | null;
}): string | null | undefined {
  if (user.role !== "user") return undefined;
  const name = user.name?.trim();
  return name || null;
}

function normalizePersonName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function filterFeishuContractsBySubmitter(
  items: FeishuContract[],
  submitter: string
) {
  const expected = normalizePersonName(submitter);
  if (!expected) return [];
  return items.filter(
    (item) => normalizePersonName(item.submitter || "") === expected
  );
}

function normalizeContractNo(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function dedupeFeishuContractsByNo(items: FeishuContract[]) {
  const unique = new Map<string, FeishuContract>();

  for (const item of items) {
    const key = normalizeContractNo(item.contractNo);
    if (!key) continue;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, {
        ...item,
        contractNo: item.contractNo.normalize("NFKC").trim(),
      });
      continue;
    }

    unique.set(key, {
      ...existing,
      title: existing.title || item.title,
      customerName: existing.customerName || item.customerName,
      businessUnit: existing.businessUnit || item.businessUnit,
      submitter: existing.submitter || item.submitter,
      signDate: existing.signDate || item.signDate,
      startDate: existing.startDate || item.startDate,
      endDate: existing.endDate || item.endDate,
      totalKeys: Math.max(existing.totalKeys, item.totalKeys),
      remark: existing.remark || item.remark,
      status:
        existing.status === "ACTIVE" || item.status === "ACTIVE"
          ? "ACTIVE"
          : existing.status,
    });
  }

  return Array.from(unique.values());
}

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
const DEFAULT_CONTRACT_RANGE = "A1:H500";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

let tokenCache: { token: string; expiresAt: number } | null = null;
let contractCache: { key: string; items: FeishuContract[]; expiresAt: number } | null = null;

function isEnabled() {
  const value = process.env.FEISHU_CONTRACTS_ENABLED;
  return value === "1" || value?.toLowerCase() === "true";
}

export function isFeishuContractsConfigured() {
  return Boolean(
    isEnabled()
      && process.env.FEISHU_APP_ID
      && process.env.FEISHU_APP_SECRET
      && (getBaseAppToken() || getSpreadsheetToken())
  );
}

/**
 * 生成密钥时是否强制绑定合同。**默认不强制**（生成密钥与合同解绑）。
 *
 * - `KEY_REQUIRE_CONTRACT=1|true` → 打开强制绑定，恢复"必须绑合同、无合同走审批"的旧行为
 * - 其余情况（含未设置、空值）→ 不强制：合同仍可选择并记录到密钥上，只是不再拦截签发
 *
 * 注意：合同列表本身仍受 isFeishuContractsConfigured() 控制，飞书没配好时列表为空，
 * 此时若强制绑定就等于把签发功能整体锁死 —— 这也是默认值取"不强制"的原因之一。
 */
export function isContractBindingRequired() {
  const raw = process.env.KEY_REQUIRE_CONTRACT?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function getBaseAppToken() {
  const raw = process.env.FEISHU_CONTRACT_BASE_APP_TOKEN
    || process.env.FEISHU_CONTRACT_BASE_URL
    || process.env.FEISHU_CONTRACT_SPREADSHEET_URL
    || "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const fromPath = url.pathname.match(/\/base\/([^/?#]+)/)?.[1];
    return fromPath || url.searchParams.get("app_token") || trimmed;
  } catch {
    return trimmed;
  }
}

function getSpreadsheetToken() {
  const raw = process.env.FEISHU_CONTRACT_SPREADSHEET_TOKEN || process.env.FEISHU_CONTRACT_SPREADSHEET_URL || "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.pathname.includes("/base/")) return "";
    const fromPath = url.pathname.match(/\/sheets\/([^/?#]+)/)?.[1];
    return fromPath || url.searchParams.get("spreadsheetToken") || trimmed;
  } catch {
    return trimmed;
  }
}

function getContractRange() {
  const range = (process.env.FEISHU_CONTRACT_RANGE || DEFAULT_CONTRACT_RANGE).trim();
  const sheetId = process.env.FEISHU_CONTRACT_SHEET_ID?.trim();
  if (!sheetId || range.includes("!")) return range;
  return `${sheetId}!${range}`;
}

function getCacheTtlMs() {
  const value = Number(process.env.FEISHU_CONTRACT_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CACHE_TTL_MS;
}

async function readJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Feishu API HTTP ${response.status}: ${await response.text()}`);
  }
  return await response.json() as T;
}

async function getTenantAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("未配置 FEISHU_APP_ID / FEISHU_APP_SECRET");

  const data = await readJson<FeishuTokenResponse>(
    `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取飞书 tenant_access_token 失败：${data.msg || data.code}`);
  }

  const ttlMs = Math.max(60, data.expire ?? 7200) * 1000;
  tokenCache = { token: data.tenant_access_token, expiresAt: now + ttlMs };
  return tokenCache.token;
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(cellToString).filter(Boolean).join("");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return cellToString(obj.text ?? obj.name ?? obj.value ?? "");
  }
  return String(value).trim();
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s_（()）:：-]/g, "");
}

function findColumn(headers: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.findIndex((header) => normalizedCandidates.includes(normalizeHeader(header)));
}

function parseStatus(value: string): ContractStatus {
  const normalized = value.toLowerCase().trim();
  if (!normalized || ["active", "生效", "生效中", "有效", "进行中"].includes(normalized)) return "ACTIVE";
  if (["draft", "草稿"].includes(normalized)) return "DRAFT";
  if (["expired", "过期", "已过期"].includes(normalized)) return "EXPIRED";
  if (["terminated", "终止", "已终止", "结束"].includes(normalized)) return "TERMINATED";
  return "ACTIVE";
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableNegativeId(contractNo: string) {
  let hash = 0;
  for (let i = 0; i < contractNo.length; i += 1) {
    hash = (hash * 31 + contractNo.charCodeAt(i)) >>> 0;
  }
  return -Math.max(1, hash % 1_000_000_000);
}

function pickField(fields: Record<string, unknown>, candidates: string[]) {
  const entries = Object.entries(fields);
  const normalizedCandidates = candidates.map(normalizeHeader);
  const found = entries.find(([key]) => normalizedCandidates.includes(normalizeHeader(key)));
  return found?.[1];
}

function mapBitableRecordsToContracts(records: FeishuBitableRecord[]): FeishuContract[] {
  const now = new Date();
  return records.reduce<FeishuContract[]>((acc, record) => {
    const fields = record.fields ?? {};
    const contractNo = cellToString(pickField(fields, ["合同编号", "合同号", "合同编码", "编号", "contractNo", "contract_no"]));
    if (!contractNo) return acc;

    const title = cellToString(pickField(fields, ["合同标题", "合同名称", "标题", "名称", "title", "contractTitle"])) || contractNo;
    const status = parseStatus(cellToString(pickField(fields, ["状态", "合同状态", "status"])));

    acc.push({
      id: stableNegativeId(record.record_id),
      contractNo,
      title,
      customerId: null,
      customerName: cellToString(pickField(fields, ["客户", "客户名称", "公司", "公司名称", "customerName"])) || null,
      businessUnit: cellToString(pickField(fields, ["订单所属事业部", "事业部", "所属事业部", "业务部门", "businessUnit", "business_unit"])) || null,
      submitter: cellToString(pickField(fields, ["提交人", "填报人", "申请人", "submitter", "submittedBy"])) || null,
      signDate: cellToString(pickField(fields, ["签订日期", "签约日期", "signDate"])) || null,
      startDate: cellToString(pickField(fields, ["开始日期", "生效日期", "startDate"])) || null,
      endDate: cellToString(pickField(fields, ["结束日期", "到期日期", "endDate"])) || null,
      totalKeys: parseNumber(cellToString(pickField(fields, ["授权数量", "密钥数量", "合同数量", "totalKeys", "total"]))),
      usedKeys: 0,
      status,
      remark: cellToString(pickField(fields, ["备注", "说明", "remark"])) || null,
      createdById: 0,
      createdByName: "飞书多维表格",
      createdAt: now,
      updatedAt: now,
      keyCount: 0,
      generatedKeyCount: 0,
      source: "feishu",
    });
    return acc;
  }, []);
}

function mapRowsToContracts(values: unknown[][]): FeishuContract[] {
  if (values.length < 2) return [];

  const headers = values[0].map(cellToString);
  const noIndex = findColumn(headers, ["合同编号", "合同号", "合同编码", "编号", "contractNo", "contract_no"]);
  const titleIndex = findColumn(headers, ["合同标题", "合同名称", "标题", "名称", "title", "contractTitle"]);
  const customerIndex = findColumn(headers, ["客户", "客户名称", "公司", "公司名称", "customerName"]);
  const businessUnitIndex = findColumn(headers, ["订单所属事业部", "事业部", "所属事业部", "业务部门", "businessUnit", "business_unit"]);
  const submitterIndex = findColumn(headers, ["提交人", "填报人", "申请人", "submitter", "submittedBy"]);
  const statusIndex = findColumn(headers, ["状态", "合同状态", "status"]);
  const totalIndex = findColumn(headers, ["授权数量", "密钥数量", "合同数量", "totalKeys", "total"]);
  const signDateIndex = findColumn(headers, ["签订日期", "签约日期", "signDate"]);
  const startDateIndex = findColumn(headers, ["开始日期", "生效日期", "startDate"]);
  const endDateIndex = findColumn(headers, ["结束日期", "到期日期", "endDate"]);
  const remarkIndex = findColumn(headers, ["备注", "说明", "remark"]);

  if (noIndex < 0) {
    throw new Error("飞书合同表缺少“合同编号”列");
  }

  const now = new Date();
  return values.slice(1)
    .reduce<FeishuContract[]>((acc, row) => {
      const contractNo = cellToString(row[noIndex]);
      if (!contractNo) return acc;
      const title = titleIndex >= 0 ? cellToString(row[titleIndex]) : contractNo;
      const status = statusIndex >= 0 ? parseStatus(cellToString(row[statusIndex])) : "ACTIVE";

      acc.push({
        id: stableNegativeId(contractNo),
        contractNo,
        title: title || contractNo,
        customerId: null,
        customerName: customerIndex >= 0 ? cellToString(row[customerIndex]) || null : null,
        businessUnit: businessUnitIndex >= 0 ? cellToString(row[businessUnitIndex]) || null : null,
        submitter: submitterIndex >= 0 ? cellToString(row[submitterIndex]) || null : null,
        signDate: signDateIndex >= 0 ? cellToString(row[signDateIndex]) || null : null,
        startDate: startDateIndex >= 0 ? cellToString(row[startDateIndex]) || null : null,
        endDate: endDateIndex >= 0 ? cellToString(row[endDateIndex]) || null : null,
        totalKeys: totalIndex >= 0 ? parseNumber(cellToString(row[totalIndex])) : 0,
        usedKeys: 0,
        status,
        remark: remarkIndex >= 0 ? cellToString(row[remarkIndex]) || null : null,
        createdById: 0,
        createdByName: "飞书表格",
        createdAt: now,
        updatedAt: now,
        keyCount: 0,
        generatedKeyCount: 0,
        source: "feishu" as const,
      });
      return acc;
    }, []);
}

async function getBitableTableId(token: string, appToken: string) {
  const configured = process.env.FEISHU_CONTRACT_TABLE_ID || process.env.FEISHU_CONTRACT_BASE_TABLE_ID;
  if (configured?.trim()) return configured.trim();

  const data = await readJson<FeishuTableListResponse>(
    `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (data.code !== 0) {
    throw new Error(`读取飞书多维表格数据表列表失败：${data.msg || data.code}`);
  }
  const first = data.data?.items?.[0]?.table_id;
  if (!first) throw new Error("飞书多维表格中未找到数据表，请配置 FEISHU_CONTRACT_TABLE_ID");
  return first;
}

async function readBitableContracts(token: string, appToken: string) {
  const tableId = await getBitableTableId(token, appToken);
  const viewId = process.env.FEISHU_CONTRACT_VIEW_ID?.trim();
  const records: FeishuBitableRecord[] = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);
    if (viewId) params.set("view_id", viewId);

    const data = await readJson<FeishuBitableRecordResponse>(
      `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${params}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (data.code !== 0) {
      throw new Error(`读取飞书多维表格记录失败：${data.msg || data.code}`);
    }

    records.push(...(data.data?.items ?? []));
    pageToken = data.data?.page_token ?? "";
    if (!data.data?.has_more) break;
  } while (pageToken);

  return mapBitableRecordsToContracts(records);
}

async function readSheetContracts(token: string, spreadsheetToken: string, range: string) {
  const data = await readJson<FeishuSheetResponse>(
    `${FEISHU_API_BASE}/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(range)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (data.code !== 0) {
    throw new Error(`读取飞书电子表格失败：${data.msg || data.code}`);
  }

  const values = data.data?.valueRange?.values ?? [];
  return mapRowsToContracts(values);
}

export async function getFeishuContracts(opts?: {
  status?: string;
  submitter?: string;
  page?: number;
  pageSize?: number;
}) {
  if (!isFeishuContractsConfigured()) {
    return {
      items: [],
      total: 0,
      source: "feishu" as const,
      error: "未配置飞书合同表：需要 FEISHU_CONTRACTS_ENABLED=true、FEISHU_APP_ID、FEISHU_APP_SECRET，并配置 FEISHU_CONTRACT_BASE_URL/BASE_APP_TOKEN 或 FEISHU_CONTRACT_SPREADSHEET_TOKEN",
    };
  }

  const token = await getTenantAccessToken();
  const baseAppToken = getBaseAppToken();
  const spreadsheetToken = getSpreadsheetToken();
  const range = getContractRange();
  const cacheKey = baseAppToken
    ? `base:${baseAppToken}:${process.env.FEISHU_CONTRACT_TABLE_ID || process.env.FEISHU_CONTRACT_BASE_TABLE_ID || ""}:${process.env.FEISHU_CONTRACT_VIEW_ID || ""}`
    : `sheet:${spreadsheetToken}:${range}`;
  const now = Date.now();
  if (!contractCache || contractCache.key !== cacheKey || contractCache.expiresAt <= now) {
    contractCache = {
      key: cacheKey,
      items: dedupeFeishuContractsByNo(
        baseAppToken
          ? await readBitableContracts(token, baseAppToken)
          : await readSheetContracts(token, spreadsheetToken, range)
      ),
      expiresAt: now + getCacheTtlMs(),
    };
  }

  const cached = contractCache;
  const scopedItems = opts?.submitter
    ? filterFeishuContractsBySubmitter(cached.items, opts.submitter)
    : cached.items;
  const status = opts?.status;
  const filtered = status
    ? scopedItems.filter((item) => item.status === status)
    : scopedItems;
  const page = opts?.page || 1;
  const pageSize = opts?.pageSize || 50;
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    source: "feishu" as const,
  };
}
