import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { auditLogs, customers, users, type User } from "../drizzle/schema";
import { getDb, getUserAndSubordinateIds } from "./db";
import { getFeishuContracts, getFeishuContractSubmitterScope } from "./feishuContracts";

export function normalizeCustomerName(name: string) {
  return name.normalize("NFKC").trim().toLocaleLowerCase();
}

export function collectFeishuCustomerNames(items: { customerName: string | null }[]) {
  const names = new Map<string, string>();
  let skipped = 0;
  for (const item of items) {
    const name = item.customerName?.trim() || "";
    if (!name || Array.from(name).length > 256) {
      skipped += 1;
      continue;
    }
    const key = normalizeCustomerName(name);
    if (!names.has(key)) names.set(key, name);
  }
  return { names, skipped };
}

export async function syncFeishuCustomersForUser(user: Pick<User, "id" | "name" | "role" | "isActive">) {
  if (!user.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "账号已被禁用" });
  const submitter = getFeishuContractSubmitterScope(user);
  if (submitter === null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请先设置账号姓名，再按飞书发起人同步客户" });
  }
  const options = { pageSize: 1000, ...(submitter ? { submitter } : {}) };
  const contracts = [] as { customerName: string | null }[];
  let totalContracts = 0;
  try {
    for (let page = 1; ; page += 1) {
      const result = await getFeishuContracts({ ...options, page });
      if (result.error) throw new Error(result.error);
      totalContracts = result.total;
      contracts.push(...result.items);
      if (contracts.length >= result.total) break;
      if (!result.items.length) throw new Error("飞书合同分页数据不完整，请重试");
    }
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "读取飞书合同失败" });
  }
  const { names, skipped } = collectFeishuCustomerNames(contracts);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用，未同步客户" });
  const userIds = await getUserAndSubordinateIds(user.id, user.role);

  return db.transaction(async (tx) => {
    // Serialize retries from the same account without changing customer ownership rules.
    const [actor] = await tx.select({ role: users.role, name: users.name, isActive: users.isActive })
      .from(users).where(eq(users.id, user.id)).for("update");
    if (!actor?.isActive || actor.role !== user.role || (user.role === "user" && actor.name?.trim() !== user.name?.trim())) {
      throw new TRPCError({ code: "FORBIDDEN", message: "账号信息已变更，请刷新后重试" });
    }
    const existing = await tx.select({ name: customers.name }).from(customers)
      .where(inArray(customers.createdById, userIds));
    const existingNames = new Set(existing.map(item => normalizeCustomerName(item.name)));
    const missing = Array.from(names).filter(([key]) => !existingNames.has(key)).map(([, name]) => ({
      name, createdById: user.id, isActive: true,
    }));
    for (let offset = 0; offset < missing.length; offset += 100) {
      await tx.insert(customers).values(missing.slice(offset, offset + 100));
    }
    const result = { created: missing.length, existing: names.size - missing.length, skipped,
      customers: names.size, contracts: totalContracts };
    await tx.insert(auditLogs).values({
      userId: user.id, userName: user.name?.slice(0, 128) || null,
      action: "CREATE", resourceType: "customer", after: JSON.stringify(result),
      description: `飞书合同客户同步：新增 ${result.created} 个，已存在 ${result.existing} 个`,
    });
    return result;
  });
}
