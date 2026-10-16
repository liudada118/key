import type { User } from "../drizzle/schema";
import { getContractSubmitterDepartments } from "./db";
import { fillFeishuContractBusinessUnits, getFeishuContracts, getFeishuContractSubmitterScope, type FeishuContract } from "./feishuContracts";

export async function readVisibleFeishuContracts(user: Pick<User, "role" | "name">) {
  const submitter = getFeishuContractSubmitterScope(user);
  if (submitter === null) throw new Error("请先设置账号姓名，再读取本人可见的飞书合同");
  const items: FeishuContract[] = [];
  for (let page = 1; ; page += 1) {
    const result = await getFeishuContracts({ page, pageSize: 1000, ...(submitter ? { submitter } : {}) });
    if (result.error) throw new Error(result.error);
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length) throw new Error("飞书合同分页数据不完整，请重试");
  }
}

export async function readVisibleContractsWithDepartments(user: Pick<User, "role" | "name">) {
  const items = await readVisibleFeishuContracts(user);
  const accounts = items.some(item => !item.businessUnit?.trim() && item.submitter?.trim())
    ? await getContractSubmitterDepartments() : [];
  return fillFeishuContractBusinessUnits(items, accounts);
}

function normalizeBusinessUnit(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function filterContractsByBusinessUnit<T extends { businessUnit: string | null }>(items: T[], businessUnit?: string) {
  if (!businessUnit) return items;
  const expected = normalizeBusinessUnit(businessUnit);
  return items.filter(item => item.businessUnit && normalizeBusinessUnit(item.businessUnit) === expected);
}

export function collectContractBusinessUnits(items: { businessUnit: string | null }[]) {
  const names = new Map<string, string>();
  for (const item of items) {
    const name = item.businessUnit?.trim();
    if (name && !names.has(normalizeBusinessUnit(name))) names.set(normalizeBusinessUnit(name), name);
  }
  return Array.from(names.values()).sort((a, b) => a.localeCompare(b, "zh-CN"));
}
