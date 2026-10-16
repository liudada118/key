import type { User } from "../drizzle/schema";
import { getContractSubmitterDepartments } from "./db";
import {
  fillFeishuContractBusinessUnits,
  getFeishuContractSubmitterScope,
  type FeishuContract,
} from "./feishuContracts";
import { normalizeCustomerName } from "./feishuCustomerSync";
import { readVisibleFeishuContracts } from "./feishuContractDirectory";

type CustomerContract = Pick<FeishuContract, "customerName" | "submitter" | "businessUnit">;

function emptyMetadata() {
  return {
    departmentNames: [] as string[],
    initiatorNames: [] as string[],
    contractCount: 0,
    unmatchedDepartmentCount: 0,
    missingInitiatorCount: 0,
  };
}

function addDistinctName(names: string[], name: string) {
  const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (!names.some(existing => normalize(existing) === normalize(name))) names.push(name);
}

export function aggregateCustomerContractMetadata(contracts: CustomerContract[]) {
  const metadata = new Map<string, ReturnType<typeof emptyMetadata>>();
  for (const contract of contracts) {
    const customerName = normalizeCustomerName(contract.customerName || "");
    if (!customerName) continue;
    const entry = metadata.get(customerName) || emptyMetadata();
    entry.contractCount += 1;
    const initiator = contract.submitter?.trim();
    const department = contract.businessUnit?.trim();
    if (initiator) addDistinctName(entry.initiatorNames, initiator);
    else entry.missingInitiatorCount += 1;
    if (department) addDistinctName(entry.departmentNames, department);
    else entry.unmatchedDepartmentCount += 1;
    metadata.set(customerName, entry);
  }
  return metadata;
}

export async function enrichCustomersWithContractMetadata<T extends { name: string }>(
  items: T[],
  user: Pick<User, "role" | "name">,
  resolvedContracts?: CustomerContract[],
) {
  const fallback = (contractMetadataError: string | null = null) => ({
    items: items.map(item => ({ ...item, ...emptyMetadata() })),
    contractMetadataError,
  });
  if (!items.length) return fallback();
  const submitter = getFeishuContractSubmitterScope(user);
  if (submitter === null) return fallback("请先设置账号姓名，再按合同发起人读取部门和发起人");

  try {
    const names = new Set(items.map(item => normalizeCustomerName(item.name)));
    const contracts = (resolvedContracts ?? await readVisibleFeishuContracts(user))
      .filter(item => names.has(normalizeCustomerName(item.customerName || "")));
    const accounts = !resolvedContracts && contracts.some(item => !item.businessUnit?.trim() && item.submitter?.trim())
      ? await getContractSubmitterDepartments()
      : [];
    const metadata = aggregateCustomerContractMetadata(fillFeishuContractBusinessUnits(contracts, accounts));
    return {
      items: items.map(item => ({ ...item, ...(metadata.get(normalizeCustomerName(item.name)) || emptyMetadata()) })),
      contractMetadataError: null,
    };
  } catch {
    // A temporary Feishu failure must not hide locally managed customer profiles.
    return fallback("合同资料暂不可用，部门和发起人读取失败");
  }
}
