import { and, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  customers,
  licenseKeys,
  users,
  type InsertCustomer,
  type InsertLicenseKey,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ===== User Helpers =====

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "super_admin";
      updateSet.role = "super_admin";
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** 获取用户管理的下级账号 */
export async function getSubordinateUsers(userId: number, role: string) {
  const db = await getDb();
  if (!db) return [];

  if (role === "super_admin") {
    return db.select().from(users).where(
      or(eq(users.role, "admin"), eq(users.role, "user"))
    ).orderBy(desc(users.createdAt));
  } else if (role === "admin") {
    return db.select().from(users).where(
      and(eq(users.createdById, userId), eq(users.role, "user"))
    ).orderBy(desc(users.createdAt));
  }
  return [];
}

/** 获取某用户及其所有下级的 ID 列表（用于密钥查询） */
export async function getUserAndSubordinateIds(userId: number, role: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [userId];

  if (role === "super_admin") {
    const allUsers = await db.select({ id: users.id }).from(users);
    return allUsers.map((u) => u.id);
  } else if (role === "admin") {
    const subs = await db.select({ id: users.id }).from(users).where(
      eq(users.createdById, userId)
    );
    return [userId, ...subs.map((u) => u.id)];
  }
  return [userId];
}

export async function createAccount(data: {
  name: string;
  role: "admin" | "user";
  createdById: number;
  remark?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const openId = `internal_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  await db.insert(users).values({
    openId,
    name: data.name,
    role: data.role,
    createdById: data.createdById,
    remark: data.remark || null,
    isActive: true,
  });

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function updateAccount(id: number, data: {
  name?: string;
  isActive?: boolean;
  remark?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.isActive !== undefined) updateSet.isActive = data.isActive;
  if (data.remark !== undefined) updateSet.remark = data.remark;

  if (Object.keys(updateSet).length > 0) {
    await db.update(users).set(updateSet).where(eq(users.id, id));
  }
  return getUserById(id);
}

// ===== Customer Helpers =====

export async function createCustomer(data: {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  remark?: string;
  createdById: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(customers).values({
    name: data.name,
    contactPerson: data.contactPerson || null,
    phone: data.phone || null,
    email: data.email || null,
    address: data.address || null,
    remark: data.remark || null,
    createdById: data.createdById,
    isActive: true,
  });

  // 返回刚创建的客户
  const result = await db.select().from(customers)
    .where(and(eq(customers.name, data.name), eq(customers.createdById, data.createdById)))
    .orderBy(desc(customers.id))
    .limit(1);
  return result[0];
}

export async function updateCustomer(id: number, data: {
  name?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  remark?: string;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.contactPerson !== undefined) updateSet.contactPerson = data.contactPerson;
  if (data.phone !== undefined) updateSet.phone = data.phone;
  if (data.email !== undefined) updateSet.email = data.email;
  if (data.address !== undefined) updateSet.address = data.address;
  if (data.remark !== undefined) updateSet.remark = data.remark;
  if (data.isActive !== undefined) updateSet.isActive = data.isActive;

  if (Object.keys(updateSet).length > 0) {
    await db.update(customers).set(updateSet).where(eq(customers.id, id));
  }

  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result[0];
}

export async function getCustomerById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** 获取客户列表（分页 + 搜索） */
export async function getCustomers(opts: {
  userIds: number[];
  page: number;
  pageSize: number;
  search?: string;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [inArray(customers.createdById, opts.userIds)];
  if (opts.search) {
    conditions.push(
      or(
        like(customers.name, `%${opts.search}%`),
        like(customers.contactPerson, `%${opts.search}%`),
        like(customers.phone, `%${opts.search}%`)
      )!
    );
  }
  if (opts.isActive !== undefined) conditions.push(eq(customers.isActive, opts.isActive));

  const where = and(...conditions);
  const offset = (opts.page - 1) * opts.pageSize;

  const [items, totalResult] = await Promise.all([
    db.select().from(customers).where(where).orderBy(desc(customers.createdAt)).limit(opts.pageSize).offset(offset),
    db.select({ count: count() }).from(customers).where(where),
  ]);

  return { items, total: totalResult[0]?.count ?? 0 };
}

/** 获取所有客户（用于下拉选择） */
export async function getAllCustomers(userIds: number[]) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: customers.id,
    name: customers.name,
    contactPerson: customers.contactPerson,
    phone: customers.phone,
  }).from(customers).where(
    and(inArray(customers.createdById, userIds), eq(customers.isActive, true))
  ).orderBy(desc(customers.createdAt));
}

/** 获取客户的密钥数量统计 */
export async function getCustomerKeyCount(customerId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: count() }).from(licenseKeys).where(eq(licenseKeys.customerId, customerId));
  return result[0]?.count ?? 0;
}

// ===== License Key Helpers =====

export async function insertLicenseKey(data: InsertLicenseKey) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(licenseKeys).values(data);
}

export async function insertLicenseKeys(dataList: InsertLicenseKey[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataList.length === 0) return;
  await db.insert(licenseKeys).values(dataList);
}

export async function getLicenseKeys(opts: {
  userIds: number[];
  page: number;
  pageSize: number;
  category?: string;
  sensorType?: string;
  isActivated?: boolean;
  search?: string;
  customerId?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [inArray(licenseKeys.createdById, opts.userIds)];

  if (opts.category) conditions.push(eq(licenseKeys.category, opts.category as "production" | "rental"));
  if (opts.sensorType) conditions.push(like(licenseKeys.sensorType, `%${opts.sensorType}%`));
  if (opts.isActivated !== undefined) conditions.push(eq(licenseKeys.isActivated, opts.isActivated));
  if (opts.customerId) conditions.push(eq(licenseKeys.customerId, opts.customerId));
  if (opts.search) {
    conditions.push(
      or(
        like(licenseKeys.keyString, `%${opts.search}%`),
        like(licenseKeys.customerName, `%${opts.search}%`)
      )!
    );
  }

  const where = and(...conditions);
  const offset = (opts.page - 1) * opts.pageSize;

  const [items, totalResult] = await Promise.all([
    db.select().from(licenseKeys).where(where).orderBy(desc(licenseKeys.createdAt)).limit(opts.pageSize).offset(offset),
    db.select({ count: count() }).from(licenseKeys).where(where),
  ]);

  return { items, total: totalResult[0]?.count ?? 0 };
}

export async function getLicenseKeyByString(keyString: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(licenseKeys).where(eq(licenseKeys.keyString, keyString)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function activateLicenseKey(keyString: string, deviceInfo?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getLicenseKeyByString(keyString);
  if (!existing) return { success: false, error: "密钥不存在" };
  if (existing.isActivated) return { success: false, error: "密钥已被激活，不可重复使用" };

  await db.update(licenseKeys).set({
    isActivated: true,
    activatedAt: new Date(),
    activatedDevice: deviceInfo || null,
  }).where(eq(licenseKeys.keyString, keyString));

  return { success: true };
}

export async function getKeyStats(userIds: number[]) {
  const db = await getDb();
  if (!db) return { total: 0, activated: 0, production: 0, rental: 0, expired: 0 };

  const where = inArray(licenseKeys.createdById, userIds);
  const now = Date.now();

  const [totalResult, activatedResult, productionResult, rentalResult, expiredResult] = await Promise.all([
    db.select({ count: count() }).from(licenseKeys).where(where),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.isActivated, true))),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.category, "production"))),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.category, "rental"))),
    db.select({ count: count() }).from(licenseKeys).where(
      and(where, sql`${licenseKeys.expireTimestamp} < ${now}`)
    ),
  ]);

  return {
    total: totalResult[0]?.count ?? 0,
    activated: activatedResult[0]?.count ?? 0,
    production: productionResult[0]?.count ?? 0,
    rental: rentalResult[0]?.count ?? 0,
    expired: expiredResult[0]?.count ?? 0,
  };
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}
