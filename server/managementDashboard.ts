import type { User } from "../drizzle/schema";
import { getCustomerDashboardRecords, getGeneratedKeyCountsByContractNos, getUserAndSubordinateIds } from "./db";
import { enrichCustomersWithContractMetadata } from "./feishuCustomerMetadata";
import { filterContractsByBusinessUnit, readVisibleContractsWithDepartments } from "./feishuContractDirectory";
import type { FeishuContract } from "./feishuContracts";

type Viewer = Pick<User, "id" | "name" | "role">;
export type CustomerCoverage = "with" | "without" | "unmatched";
const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

export async function readCustomerDashboardDirectory(user: Viewer, filters: { search?: string; businessUnit?: string }) {
  const userIds = await getUserAndSubordinateIds(user.id, user.role);
  const records = await getCustomerDashboardRecords(userIds, filters.search);
  const result = await enrichCustomersWithContractMetadata(records, user);
  if (filters.businessUnit && result.contractMetadataError) throw new Error("事业部资料暂不可用");
  const items = filters.businessUnit ? result.items.filter(row => row.departmentNames.some(
    name => normalize(name) === normalize(filters.businessUnit!),
  )) : result.items;
  return { items, contractMetadataError: result.contractMetadataError };
}

export function matchesCustomerCoverage(row: { contractCount: number; unmatchedDepartmentCount: number }, coverage: CustomerCoverage) {
  return coverage === "with" ? row.contractCount > 0 : coverage === "without" ? row.contractCount === 0 : row.unmatchedDepartmentCount > 0;
}

export function summarizeCustomers(result: Awaited<ReturnType<typeof readCustomerDashboardDirectory>>) {
  const { items, contractMetadataError } = result;
  const departments = new Map<string, { name: string; value: number }>();
  for (const row of items) for (const name of row.departmentNames) {
    const key = normalize(name), entry = departments.get(key) || { name, value: 0 };
    entry.value += 1;
    departments.set(key, entry);
  }
  return {
    total: items.length, active: items.filter(row => row.isActive).length,
    withContracts: contractMetadataError ? null : items.filter(row => row.contractCount > 0).length,
    withoutContracts: contractMetadataError ? null : items.filter(row => row.contractCount === 0).length,
    unmatched: contractMetadataError ? null : items.filter(row => row.unmatchedDepartmentCount > 0).length,
    departments: Array.from(departments.values()).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN")),
    contractMetadataError,
  };
}

export function summarizeContracts(items: FeishuContract[], counts: Record<string, number>) {
  const departments = new Map<string, { name: string; value: number; issued: number }>();
  const statuses: Record<string, number> = { DRAFT: 0, ACTIVE: 0, EXPIRED: 0, TERMINATED: 0 };
  let issued = 0, waiting = 0, unmatched = 0;
  for (const row of items) {
    const hasKey = (counts[row.contractNo] ?? 0) > 0;
    if (hasKey) issued += 1;
    if (!hasKey && row.status === "ACTIVE") waiting += 1;
    if (!row.businessUnit?.trim()) unmatched += 1;
    statuses[row.status] = (statuses[row.status] || 0) + 1;
    const name = row.businessUnit?.trim() || "待匹配部门", key = normalize(name);
    const entry = departments.get(key) || { name, value: 0, issued: 0 };
    entry.value += 1;
    if (hasKey) entry.issued += 1;
    departments.set(key, entry);
  }
  return { total: items.length, active: statuses.ACTIVE, issued, waiting, unmatched, statuses,
    departments: Array.from(departments.values()).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh-CN")) };
}

export async function getContractDashboard(user: Viewer, businessUnit?: string) {
  const items = filterContractsByBusinessUnit(await readVisibleContractsWithDepartments(user), businessUnit);
  const counts = await getGeneratedKeyCountsByContractNos(items.map(row => row.contractNo));
  return summarizeContracts(items, counts);
}
