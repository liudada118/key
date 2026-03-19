import { and, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  customers,
  licenseKeys,
  sensorTypes,
  users,
  type InsertCustomer,
  type InsertLicenseKey,
  type InsertSensorType,
} from "../drizzle/schema";
import bcrypt from "bcryptjs";

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

// ===== User / Auth Helpers =====

/** 通过用户名查找用户 */
export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** 验证用户名密码 */
export async function verifyUserCredentials(username: string, password: string) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  if (!user.isActive) return null;

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;

  // 更新最后登录时间
  const db = await getDb();
  if (db) {
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
  }

  return user;
}

/** 创建用户（带密码哈希） */
export async function createUserWithPassword(data: {
  username: string;
  password: string;
  name: string;
  role: "super_admin" | "admin" | "user";
  createdById?: number | null;
  remark?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const hashedPassword = await bcrypt.hash(data.password, 10);

  await db.insert(users).values({
    username: data.username,
    password: hashedPassword,
    name: data.name,
    role: data.role,
    createdById: data.createdById ?? null,
    remark: data.remark ?? null,
    isActive: true,
  });

  const result = await db.select().from(users).where(eq(users.username, data.username)).limit(1);
  return result[0];
}

/** 初始化默认超级管理员（如果不存在） */
export async function ensureDefaultSuperAdmin() {
  const db = await getDb();
  if (!db) return;

  const existing = await db.select().from(users).where(eq(users.role, "super_admin")).limit(1);
  if (existing.length > 0) return;

  console.log("[Init] Creating default super admin: admin / admin123");
  await createUserWithPassword({
    username: "admin",
    password: "admin123",
    name: "超级管理员",
    role: "super_admin",
    createdById: null,
  });
  console.log("[Init] Default super admin created successfully");
}

/** 确保默认传感器类型存在 */
export async function ensureDefaultSensorTypes() {
  const db = await getDb();
  if (!db) return;

  // 检查是否已有传感器数据
  const existing = await db.select().from(sensorTypes).limit(1);
  if (existing.length > 0) return;

  console.log("[Init] Creating default sensor types...");
  const defaultSensors: InsertSensorType[] = [
    // 常用
    { label: "手部检测", value: "hand", groupName: "常用", groupIcon: "🖐️", sortOrder: 1, isActive: true },
    // 关怀
    { label: "小床监测", value: "jqbed", groupName: "关怀", groupIcon: "🛏️", sortOrder: 10, isActive: true },
    // 精密
    { label: "触觉手套", value: "hand0205", groupName: "精密", groupIcon: "🧤", sortOrder: 20, isActive: true },
    { label: "触觉手套(115200)", value: "handGlove115200", groupName: "精密", groupIcon: "🧤", sortOrder: 21, isActive: true },
    { label: "小型样品", value: "smallSample", groupName: "精密", groupIcon: "🧤", sortOrder: 22, isActive: true },
    { label: "宇树G1触觉上衣", value: "robot1", groupName: "精密", groupIcon: "🧤", sortOrder: 23, isActive: true },
    { label: "松延N2触觉上衣", value: "robotSY", groupName: "精密", groupIcon: "🧤", sortOrder: 24, isActive: true },
    { label: "零次方H1触觉上衣", value: "robotLCF", groupName: "精密", groupIcon: "🧤", sortOrder: 25, isActive: true },
    { label: "触觉足底", value: "footVideo", groupName: "精密", groupIcon: "🧤", sortOrder: 26, isActive: true },
    { label: "14x20高速", value: "daliegu", groupName: "精密", groupIcon: "🧤", sortOrder: 27, isActive: true },
    { label: "16x16高速", value: "fast256", groupName: "精密", groupIcon: "🧤", sortOrder: 28, isActive: true },
    { label: "32x32高速", value: "fast1024", groupName: "精密", groupIcon: "🧤", sortOrder: 29, isActive: true },
  ];

  for (const sensor of defaultSensors) {
    await db.insert(sensorTypes).values(sensor);
  }
  console.log(`[Init] Created ${defaultSensors.length} default sensor types`);
}

/** 修改密码 */
export async function changePassword(userId: number, newPassword: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
}

/** 重置密码（管理员操作） */
export async function resetPassword(userId: number, newPassword: string) {
  return changePassword(userId, newPassword);
}

/** 获取用户管理的下级账号 */
export async function getSubordinateUsers(userId: number, role: string) {
  const db = await getDb();
  if (!db) return [];

  if (role === "super_admin") {
    return db.select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      role: users.role,
      createdById: users.createdById,
      isActive: users.isActive,
      remark: users.remark,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastSignedIn: users.lastSignedIn,
    }).from(users).where(
      or(eq(users.role, "admin"), eq(users.role, "user"))
    ).orderBy(desc(users.createdAt));
  } else if (role === "admin") {
    return db.select({
      id: users.id,
      username: users.username,
      name: users.name,
      email: users.email,
      role: users.role,
      createdById: users.createdById,
      isActive: users.isActive,
      remark: users.remark,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastSignedIn: users.lastSignedIn,
    }).from(users).where(
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
  username: string;
  password: string;
  name: string;
  role: "admin" | "user";
  createdById: number;
  remark?: string;
}) {
  return createUserWithPassword({
    username: data.username,
    password: data.password,
    name: data.name,
    role: data.role,
    createdById: data.createdById,
    remark: data.remark,
  });
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

/** 更新密钥类型（量产/租赁） */
export async function updateLicenseKeyCategory(keyId: number, category: "production" | "rental") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(licenseKeys).set({ category }).where(eq(licenseKeys.id, keyId));
  const result = await db.select().from(licenseKeys).where(eq(licenseKeys.id, keyId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** 根据 ID 获取密钥 */
export async function getLicenseKeyById(keyId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(licenseKeys).where(eq(licenseKeys.id, keyId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ===== Sensor Type Helpers =====

/** 获取所有启用的传感器类型（按分组和排序） */
export async function getSensorTypesGrouped() {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select().from(sensorTypes)
    .where(eq(sensorTypes.isActive, true))
    .orderBy(sensorTypes.sortOrder);

  // 按分组聚合
  const groupMap = new Map<string, { group: string; icon: string; items: { label: string; value: string; id: number }[] }>();
  for (const s of all) {
    if (!groupMap.has(s.groupName)) {
      groupMap.set(s.groupName, { group: s.groupName, icon: s.groupIcon, items: [] });
    }
    groupMap.get(s.groupName)!.items.push({ label: s.label, value: s.value, id: s.id });
  }
  return Array.from(groupMap.values());
}

/** 获取所有传感器类型（包括禁用的，管理用） */
export async function getAllSensorTypes() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sensorTypes).orderBy(sensorTypes.sortOrder);
}

/** 添加传感器类型 */
export async function addSensorType(data: {
  label: string;
  value: string;
  groupName: string;
  groupIcon?: string;
  sortOrder?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 检查 value 是否已存在
  const existing = await db.select().from(sensorTypes).where(eq(sensorTypes.value, data.value)).limit(1);
  if (existing.length > 0) throw new Error("传感器标识符已存在");

  // 如果没指定 sortOrder，取同组最大值 +1
  let order = data.sortOrder ?? 0;
  if (!data.sortOrder) {
    const maxResult = await db.select({ max: sql<number>`MAX(${sensorTypes.sortOrder})` })
      .from(sensorTypes)
      .where(eq(sensorTypes.groupName, data.groupName));
    order = (maxResult[0]?.max ?? 0) + 1;
  }

  await db.insert(sensorTypes).values({
    label: data.label,
    value: data.value,
    groupName: data.groupName,
    groupIcon: data.groupIcon || "📦",
    sortOrder: order,
    isActive: true,
  });

  const result = await db.select().from(sensorTypes).where(eq(sensorTypes.value, data.value)).limit(1);
  return result[0];
}

/** 删除传感器类型（软删除） */
export async function deleteSensorType(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sensorTypes).set({ isActive: false }).where(eq(sensorTypes.id, id));
}

/** 恢复传感器类型 */
export async function restoreSensorType(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sensorTypes).set({ isActive: true }).where(eq(sensorTypes.id, id));
}

/** 更新传感器类型 */
export async function updateSensorType(id: number, data: {
  label?: string;
  groupName?: string;
  groupIcon?: string;
  sortOrder?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (data.label !== undefined) updateSet.label = data.label;
  if (data.groupName !== undefined) updateSet.groupName = data.groupName;
  if (data.groupIcon !== undefined) updateSet.groupIcon = data.groupIcon;
  if (data.sortOrder !== undefined) updateSet.sortOrder = data.sortOrder;
  if (Object.keys(updateSet).length > 0) {
    await db.update(sensorTypes).set(updateSet).where(eq(sensorTypes.id, id));
  }
  const result = await db.select().from(sensorTypes).where(eq(sensorTypes.id, id)).limit(1);
  return result[0];
}

/** 获取所有分组名称和图标 */
export async function getSensorGroups() {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select({
    groupName: sensorTypes.groupName,
    groupIcon: sensorTypes.groupIcon,
  }).from(sensorTypes).groupBy(sensorTypes.groupName, sensorTypes.groupIcon);
  return all;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    username: users.username,
    name: users.name,
    email: users.email,
    role: users.role,
    createdById: users.createdById,
    isActive: users.isActive,
    remark: users.remark,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(desc(users.createdAt));
}
