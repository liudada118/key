import { and, count, desc, eq, gte, inArray, isNull, isNotNull, like, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  auditLogs,
  contracts,
  customers,
  deviceHeartbeats,
  keyDevices,
  keyStatusHistory,
  licenseKeys,
  offlineKeys,
  rsaKeyPairs,
  sensorTypes,
  teams,
  users,
  type InsertCustomer,
  type InsertKeyDevice,
  type InsertLicenseKey,
  type InsertOfflineKey,
  type InsertSensorType,
  type InsertAuditLog,
  type InsertKeyStatusHistory,
  type KeyStatus,
  type InsertContract,
} from "../drizzle/schema";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { generateLicenseKey, decodeLicenseKey } from "../shared/crypto";

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
/**
 * 桌面端原有的授权传感器类型（权威清单，共 26 个）。
 * 与桌面端 Title.jsx 的 allSensorArr 授权闸对齐（value 逐字一致才能解锁）。
 * 约束：只增不删、不改 value（value 是桌面端识别键）；label 可改。
 * 新增类型必须同时在桌面端 allSensorArr 登记，否则发出的 key 用户选不到。
 */
const DEFAULT_SENSOR_TYPES: InsertSensorType[] = [
  // 常用
  { label: "手部检测", value: "hand", groupName: "常用", groupIcon: "🖐️", sortOrder: 1, isActive: true },
  // 关怀
  { label: "小床监测", value: "jqbed", groupName: "关怀", groupIcon: "🛏️", sortOrder: 2, isActive: true },
  { label: "宠物看护", value: "petCare", groupName: "关怀", groupIcon: "🛏️", sortOrder: 3, isActive: true },
  { label: "mini看护", value: "petCareMini", groupName: "关怀", groupIcon: "🛏️", sortOrder: 4, isActive: true },
  // lab
  { label: "OneStep", value: "bed4096", groupName: "lab", groupIcon: "🧪", sortOrder: 5, isActive: true },
  // 定制
  { label: "小床检测(数据)", value: "smallBedNoAlg", groupName: "定制", groupIcon: "🛠️", sortOrder: 6, isActive: true },
  { label: "小床检测(12B)", value: "smallBed12B", groupName: "定制", groupIcon: "🛠️", sortOrder: 7, isActive: true },
  { label: "温度全床系统", value: "tempFullBed", groupName: "定制", groupIcon: "🛠️", sortOrder: 8, isActive: true },
  { label: "整椅展示", value: "wholeChair", groupName: "定制", groupIcon: "🛠️", sortOrder: 9, isActive: true },
  { label: "轮椅", value: "minzhen", groupName: "定制", groupIcon: "🛠️", sortOrder: 10, isActive: true },
  // 精密
  { label: "32*32(检测点)", value: "handSinglePoint", groupName: "精密", groupIcon: "🧤", sortOrder: 11, isActive: true },
  { label: "触觉手套", value: "hand0205", groupName: "精密", groupIcon: "🧤", sortOrder: 12, isActive: true },
  { label: "触觉手套2", value: "hand0205Double", groupName: "精密", groupIcon: "🧤", sortOrder: 13, isActive: true },
  { label: "触觉手套(115200)", value: "handGlove115200", groupName: "精密", groupIcon: "🧤", sortOrder: 14, isActive: true },
  { label: "触觉手套(整包)", value: "handGloveFullPacket", groupName: "精密", groupIcon: "🧤", sortOrder: 15, isActive: true },
  { label: "10*10小样", value: "smallSample", groupName: "精密", groupIcon: "🧤", sortOrder: 16, isActive: true },
  { label: "宇树G1触觉上衣", value: "robot1", groupName: "精密", groupIcon: "🧤", sortOrder: 17, isActive: true },
  { label: "松延N2触觉上衣", value: "robotSY", groupName: "精密", groupIcon: "🧤", sortOrder: 18, isActive: true },
  { label: "零次方H1触觉上衣", value: "robotLCF", groupName: "精密", groupIcon: "🧤", sortOrder: 19, isActive: true },
  { label: "触觉足底", value: "footVideo", groupName: "精密", groupIcon: "🧤", sortOrder: 20, isActive: true },
  { label: "14x20高速", value: "daliegu", groupName: "精密", groupIcon: "🧤", sortOrder: 21, isActive: true },
  { label: "16x16高速", value: "fast256", groupName: "精密", groupIcon: "🧤", sortOrder: 22, isActive: true },
  { label: "32x32高速", value: "fast1024", groupName: "精密", groupIcon: "🧤", sortOrder: 23, isActive: true },
  { label: "人体全身", value: "humanBody", groupName: "精密", groupIcon: "🧤", sortOrder: 24, isActive: true },
  { label: "64*64高速", value: "bed4096num", groupName: "精密", groupIcon: "🧤", sortOrder: 25, isActive: true },
  // 常用（测试）
  { label: "正常测试", value: "normal", groupName: "常用", groupIcon: "🖐️", sortOrder: 26, isActive: true },
];

/**
 * 将传感器类型表校准为权威清单（DEFAULT_SENSOR_TYPES，即桌面端识别的 24 个）。
 * 以桌面端为唯一标准，保证后台与桌面端完全一致，每次启动幂等执行：
 *  1. 缺失的权威 value -> 插入；
 *  2. 已存在的权威 value -> 纠正 label/分组/图标/排序，并确保启用（覆盖历史脏数据，如 smallSample 的旧标签）；
 *  3. 不在权威清单内的旧类型（早期迁移脚本灌入的 gloves/car/volvo 等）-> 停用（软处理，按 value 授权仍有效，仅从列表隐藏）。
 */
export async function ensureDefaultSensorTypes() {
  const db = await getDb();
  if (!db) return;

  const authoritativeValues = DEFAULT_SENSOR_TYPES.map((s) => s.value);
  const existing = await db
    .select({
      value: sensorTypes.value,
      label: sensorTypes.label,
      groupName: sensorTypes.groupName,
      groupIcon: sensorTypes.groupIcon,
      sortOrder: sensorTypes.sortOrder,
      isActive: sensorTypes.isActive,
    })
    .from(sensorTypes);
  const existingByValue = new Map(existing.map((s) => [s.value, s]));

  let inserted = 0;
  let corrected = 0;
  for (const sensor of DEFAULT_SENSOR_TYPES) {
    const row = existingByValue.get(sensor.value);
    if (!row) {
      await db.insert(sensorTypes).values(sensor);
      inserted++;
      continue;
    }
    // 已存在：若 label/分组/图标/排序/启用状态与权威清单不一致则纠正
    const needsFix =
      row.label !== sensor.label ||
      row.groupName !== sensor.groupName ||
      row.groupIcon !== sensor.groupIcon ||
      row.sortOrder !== sensor.sortOrder ||
      row.isActive !== true;
    if (needsFix) {
      await db
        .update(sensorTypes)
        .set({
          label: sensor.label,
          groupName: sensor.groupName,
          groupIcon: sensor.groupIcon,
          sortOrder: sensor.sortOrder,
          isActive: true,
        })
        .where(eq(sensorTypes.value, sensor.value));
      corrected++;
    }
  }

  // 停用不在权威清单内、且当前仍启用的旧类型
  const staleActiveValues = existing
    .filter((s) => s.isActive && !authoritativeValues.includes(s.value))
    .map((s) => s.value);
  if (staleActiveValues.length > 0) {
    await db
      .update(sensorTypes)
      .set({ isActive: false })
      .where(inArray(sensorTypes.value, staleActiveValues));
  }

  if (inserted || corrected || staleActiveValues.length) {
    console.log(
      `[Init] Sensor types reconciled to authoritative list: +${inserted} inserted, ${corrected} corrected, ${staleActiveValues.length} deactivated (${authoritativeValues.length} authoritative)`
    );
  }
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
  // 生成密钥哈希用于安全比对
  const keyHash = crypto.createHash("sha256").update(data.keyString as string).digest("hex");
  await db.insert(licenseKeys).values({ ...data, keyHash, status: "ISSUED" });
}

export async function insertLicenseKeys(dataList: InsertLicenseKey[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataList.length === 0) return;
  const dataWithHash = dataList.map((d) => ({
    ...d,
    keyHash: crypto.createHash("sha256").update(d.keyString as string).digest("hex"),
    status: "ISSUED" as const,
  }));
  await db.insert(licenseKeys).values(dataWithHash);
}

export async function getLicenseKeys(opts: {
  userIds: number[];
  page: number;
  pageSize: number;
  category?: string;
  genType?: "single" | "batch";
  sensorType?: string;
  isActivated?: boolean;
  status?: string;
  search?: string;
  customerId?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [inArray(licenseKeys.createdById, opts.userIds)];

  if (opts.category) conditions.push(eq(licenseKeys.category, opts.category as "production" | "rental"));
  // 单个生成 = batchId 为空；批量生成 = batchId 非空
  if (opts.genType === "single") conditions.push(isNull(licenseKeys.batchId));
  if (opts.genType === "batch") conditions.push(isNotNull(licenseKeys.batchId));
  if (opts.sensorType) conditions.push(like(licenseKeys.sensorType, `%${opts.sensorType}%`));
  if (opts.isActivated !== undefined) conditions.push(eq(licenseKeys.isActivated, opts.isActivated));
  if (opts.status) conditions.push(eq(licenseKeys.status, opts.status as any));
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

/**
 * 标记密钥为"已激活"（在线版客户端首次校验通过时调用）。
 * 仅在尚未激活时更新；状态为 ISSUED 时同步置为 ACTIVATED（不覆盖 RENEWED 等其它状态）。
 * @returns 是否本次刚激活
 */
export async function markLicenseKeyActivated(keyString: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rec = await getLicenseKeyByString(keyString);
  if (!rec || rec.isActivated) return false;
  const patch: Record<string, unknown> = { isActivated: true, activatedAt: new Date() };
  if (rec.status === "ISSUED") patch.status = "ACTIVATED";
  await db.update(licenseKeys).set(patch).where(eq(licenseKeys.id, rec.id));
  return true;
}

/**
 * 客户自助激活密钥（绑定设备）
 * 流程：验证密钥有效性 → 检查设备是否已绑定 → 检查设备数量上限 → 绑定设备
 */
export async function activateLicenseKey(keyString: string, deviceCode?: string, deviceName?: string, clientIp?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getLicenseKeyByString(keyString);
  if (!existing) return { success: false, error: "密钥不存在" };

  // 检查密钥生命周期状态
  if (existing.status === "REVOKED") {
    return { success: false, error: "密钥已被吊销，无法使用" };
  }
  if (existing.status === "SUSPENDED") {
    return { success: false, error: "密钥已被暂停，请联系管理员" };
  }

  // 检查密钥是否过期
  if (existing.expireTimestamp < Date.now()) {
    // 自动更新状态为过期
    if (existing.status !== "EXPIRED") {
      await db.update(licenseKeys).set({ status: "EXPIRED" }).where(eq(licenseKeys.id, existing.id));
    }
    return { success: false, error: "密钥已过期" };
  }

  if (!deviceCode) {
    return { success: false, error: "设备码不能为空" };
  }

  const trimmedDeviceCode = deviceCode.trim();

  // 检查该设备是否已绑定此密钥
  const existingDevice = await db.select().from(keyDevices)
    .where(and(eq(keyDevices.keyId, existing.id), eq(keyDevices.deviceCode, trimmedDeviceCode)))
    .limit(1);
  if (existingDevice.length > 0) {
    return { success: true, message: "该设备已绑定此密钥，无需重复激活", alreadyBound: true };
  }

  // 检查设备数量上限
  const boundDevices = await db.select({ count: count() }).from(keyDevices)
    .where(eq(keyDevices.keyId, existing.id));
  const currentCount = boundDevices[0]?.count ?? 0;

  if (existing.maxDevices > 0 && currentCount >= existing.maxDevices) {
    return {
      success: false,
      error: `设备绑定数量已达上限（${existing.maxDevices}台）`,
      currentDevices: currentCount,
      maxDevices: existing.maxDevices,
    };
  }

  // 绑定设备
  await db.insert(keyDevices).values({
    keyId: existing.id,
    deviceCode: trimmedDeviceCode,
    deviceName: deviceName || null,
    boundIp: clientIp || null,
  });

  // 更新密钥激活状态（首次绑定时设置）
  if (!existing.isActivated) {
    await db.update(licenseKeys).set({
      isActivated: true,
      status: "ACTIVATED",
      activatedAt: new Date(),
      activatedDevice: trimmedDeviceCode,
    }).where(eq(licenseKeys.id, existing.id));
    // 记录状态变更历史
    await recordKeyStatusChange({
      keyType: "online",
      keyId: existing.id,
      fromStatus: existing.status as KeyStatus,
      toStatus: "ACTIVATED",
      reason: `设备 ${trimmedDeviceCode} 首次激活`,
      actorId: 0, // 客户端自助激活
      actorName: "客户端",
    });
  }

  return {
    success: true,
    message: "设备绑定成功",
    currentDevices: currentCount + 1,
    maxDevices: existing.maxDevices,
  };
}

/** 获取密钥已绑定的设备列表 */
export async function getKeyDevices(keyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(keyDevices)
    .where(eq(keyDevices.keyId, keyId))
    .orderBy(desc(keyDevices.boundAt));
}

/** 获取密钥已绑定设备数量 */
export async function getKeyDeviceCount(keyId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: count() }).from(keyDevices)
    .where(eq(keyDevices.keyId, keyId));
  return result[0]?.count ?? 0;
}

/** 解绑设备 */
export async function unbindKeyDevice(keyId: number, deviceId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(keyDevices).where(
    and(eq(keyDevices.keyId, keyId), eq(keyDevices.id, deviceId))
  );
  // 检查是否还有绑定设备，如果没有则重置激活状态
  const remaining = await getKeyDeviceCount(keyId);
  if (remaining === 0) {
    await db.update(licenseKeys).set({
      isActivated: false,
      status: "ISSUED",
      activatedAt: null,
      activatedDevice: null,
    }).where(eq(licenseKeys.id, keyId));
  }
  return { success: true, remainingDevices: remaining };
}

/** 检查密钥在指定设备上是否有效 */
export async function verifyKeyOnDevice(keyString: string, deviceCode: string) {
  const db = await getDb();
  if (!db) return { valid: false, error: "Database not available" };

  const key = await getLicenseKeyByString(keyString.trim());
  if (!key) return { valid: false, error: "密钥不存在" };

  // 检查生命周期状态
  if (key.status === "REVOKED") {
    return { valid: false, error: "密钥已被吊销", revoked: true };
  }
  if (key.status === "SUSPENDED") {
    return { valid: false, error: "密钥已被暂停", suspended: true };
  }

  // 检查过期
  if (key.expireTimestamp < Date.now()) {
    return { valid: false, error: "密钥已过期", expired: true };
  }

  // 检查设备是否已绑定
  const device = await db.select().from(keyDevices)
    .where(and(eq(keyDevices.keyId, key.id), eq(keyDevices.deviceCode, deviceCode.trim())))
    .limit(1);

  if (device.length === 0) {
    // 设备未绑定，检查是否可以绑定
    const deviceCount = await getKeyDeviceCount(key.id);
    const canBind = key.maxDevices === 0 || deviceCount < key.maxDevices;
    return {
      valid: false,
      error: "该设备未绑定此密钥",
      notBound: true,
      canBind,
      currentDevices: deviceCount,
      maxDevices: key.maxDevices,
    };
  }

  return { valid: true, boundAt: device[0].boundAt };
}

export async function getKeyStats(userIds: number[]) {
  const db = await getDb();
  if (!db) return { total: 0, activated: 0, production: 0, rental: 0, expired: 0, suspended: 0, revoked: 0 };

  const where = inArray(licenseKeys.createdById, userIds);
  const now = Date.now();

  const [totalResult, activatedResult, productionResult, rentalResult, expiredResult, suspendedResult, revokedResult] = await Promise.all([
    db.select({ count: count() }).from(licenseKeys).where(where),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.isActivated, true))),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.category, "production"))),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.category, "rental"))),
    db.select({ count: count() }).from(licenseKeys).where(
      and(where, sql`${licenseKeys.expireTimestamp} < ${now}`)
    ),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.status, "SUSPENDED"))),
    db.select({ count: count() }).from(licenseKeys).where(and(where, eq(licenseKeys.status, "REVOKED"))),
  ]);

  return {
    total: totalResult[0]?.count ?? 0,
    activated: activatedResult[0]?.count ?? 0,
    production: productionResult[0]?.count ?? 0,
    rental: rentalResult[0]?.count ?? 0,
    expired: expiredResult[0]?.count ?? 0,
    suspended: suspendedResult[0]?.count ?? 0,
    revoked: revokedResult[0]?.count ?? 0,
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

// ===== RSA Key Pair Helpers =====

/** 生成 RSA 密钥对并存储到数据库 */
export async function generateAndStoreRsaKeyPair(name: string = "default", keySize: number = 2048) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: keySize,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // 将其他密钥对设为非活跃
  await db.update(rsaKeyPairs).set({ isActive: false });

  await db.insert(rsaKeyPairs).values({
    name,
    privateKey,
    publicKey,
    keySize,
    isActive: true,
  });

  const result = await db.select().from(rsaKeyPairs).where(eq(rsaKeyPairs.isActive, true)).limit(1);
  return result[0];
}

/** 获取当前活跃的 RSA 密钥对 */
export async function getActiveRsaKeyPair() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(rsaKeyPairs).where(eq(rsaKeyPairs.isActive, true)).limit(1);
  return result.length > 0 ? result[0] : null;
}

/** 导入已有的 RSA 密钥对到数据库 */
export async function importRsaKeyPair(name: string, privateKeyPem: string, publicKeyPem: string, keySize: number = 2048) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 将其他密钥对设为非活跃
  await db.update(rsaKeyPairs).set({ isActive: false });

  await db.insert(rsaKeyPairs).values({
    name,
    privateKey: privateKeyPem,
    publicKey: publicKeyPem,
    keySize,
    isActive: true,
  });

  const result = await db.select().from(rsaKeyPairs).where(eq(rsaKeyPairs.isActive, true)).limit(1);
  return result[0];
}

// 预置的 RSA 密钥对（与客户端公钥匹配）
const DEFAULT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDTGXL4aD/wu+hZ
XRVE7+SXV0RBG3s3rKKULbKLNr5bVXZpdYqiIuWQ9wlr0pCY0CuNwerycEuUSmke
PASba7lKuAAM/9+t/WfwZmlF6NmjoBvWmymlSb+d5VyjGwr7TPprTQH2zK/wAQi3
aOs3hlnPPnUyAmrOBeao9qJu3MaXxEWvWNgnYmlc16zoGoWmNCeDVLyG7hWBYEiW
OQTeMoV8fBM/0o+0Rygf+5I+Zblfsi7CkNbZA7qw7rW6/+W4sjhbHi6lfgIhR6nA
jMPIboF9jHYABknWg0QFbbzAhR/uLmxVPQWxZGxHnlDcpRyyKoBRV24qIpNA3d2e
ZvILUWABAgMBAAECggEAUx98RBBYzSRQ049xppmHu4gjWjfGByA1TH/KBENkJXa7
j782/a0cFD8SOKDLS0D9RW6MYzaQrC24wq0Da2e5qJBXhMbkfxB/cwwAfAS6XlHX
ZGPovCsUBsqf9aHaayXenY3PLi1fQfRGSGJJ7K08g/ymDTEieUmdj/6960WH9Y4d
up9E7kQ1MzEv/gGOZGFRUYpMq4mnhAa4G1UqYd90gQTwlA7c530FA15CA0RpQ18S
7DyI4BAPyo/LQkXrKPuAgxoVd9Z63q1n3XnW0VMneYM+d/weZB5HL4i3EWNH4abI
nlOZWUHMhP4q+0bLSj8cQLORI/MJuspggy9KMoh0mQKBgQDTw2PPkn9f4Yyl/lYI
2xoTELDjVzHc5eqzBHD2e356DCZHuXLy67VCCVCzhbEHZKC7qBgRqeF5PVWd5FES
V2oDrTXFgEcVQxaWvtMzTjLjd4MDD4a3uzK1sHZ0qp+SQzKXPKrYvTHKr/hUi28g
jm3oZ8VIcJIbdb+DBQaQplTD2wKBgQD/Mo8eO2VGPRwNm3tkRXXOBqIKc6AtH3Ru
pGYgh3gVWrHgyKpmp9BzTuwNO2PXLvysgiSYsjWuSh2wHNOimn67aL0NzRqlT+nw
87NfCyq5p5HkJ/dSxiIoBGAcrIBVzt5JlmV1bBTki7KatU7CiGH/V4w3d4isgsyo
hDqH/FegUwKBgHWD+9LIOJlr4JKJhxMZC+pCm/c9fzVX/hvkPg/6zmBKd7/b4Td/
qLIB22AUs/4nUK9zBBBhVvfiGq4pcvgbvIBX0fxNSKU6+sEjGq9hGQp0WycKqbcy
UlzTlZj+ytjvI5ccGq92prgVWVkJm9zUTZfoZmnh1qMYf/PkiRUiyO17AoGAeauT
TKio2locW+h7Zg0v43CKJU2HWrwaeP3sqymreRLqp+9EPvlXiwJfzNc5/MgsM9tA
s4STz2sKyIKV7HqYXaXMLR5Sy+pT8Utfg7sBPc7E4fCkHFTWyBl98W3VKhQdKxyH
dvp245gvKU+0I09+2YzWD0PwZ79c8CNK/La02H0CgYAMqNw1U8nkfibNh0IOIaL7
iWG0+9CwHbALZhz9K/JSrwfUIzrhWTm1w1LooAswvWzy2EZ3DMIGHyRgdakD9gyF
fmlJoyoeruBRSk72k8aCDfW912BODfPZHQYMPLLI9OtWIMgjs81bLwWTJiyeqzvl
uUDoPv7W6tGfG/PEmkxvFg==
-----END PRIVATE KEY-----`;

const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0xly+Gg/8LvoWV0VRO/k
l1dEQRt7N6yilC2yiza+W1V2aXWKoiLlkPcJa9KQmNArjcHq8nBLlEppHjwEm2u5
SrgADP/frf1n8GZpRejZo6Ab1psppUm/neVcoxsK+0z6a00B9syv8AEIt2jrN4ZZ
zz51MgJqzgXmqPaibtzGl8RFr1jYJ2JpXNes6BqFpjQng1S8hu4VgWBIljkE3jKF
fHwTP9KPtEcoH/uSPmW5X7IuwpDW2QO6sO61uv/luLI4Wx4upX4CIUepwIzDyG6B
fYx2AAZJ1oNEBW28wIUf7i5sVT0FsWRsR55Q3KUcsiqAUVduKiKTQN3dnmbyC1Fg
AQIDAQAB
-----END PUBLIC KEY-----`;

/** 确保至少存在一个 RSA 密钥对（使用预置密钥） */
export async function ensureRsaKeyPair() {
  const existing = await getActiveRsaKeyPair();
  if (existing) {
    // 检查现有密钥对的公钥是否与预置密钥匹配
    const existingPubNorm = existing.publicKey.replace(/\s/g, '');
    const defaultPubNorm = DEFAULT_PUBLIC_KEY.replace(/\s/g, '');
    if (existingPubNorm === defaultPubNorm) {
      return existing;
    }
    // 密钥不匹配，替换为预置密钥
    console.log("[Init] RSA key pair mismatch, replacing with default key pair...");
    return importRsaKeyPair("default", DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, 2048);
  }
  console.log("[Init] Importing default RSA key pair...");
  return importRsaKeyPair("default", DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, 2048);
}

/** 获取所有 RSA 密钥对（不含私钥） */
export async function getAllRsaKeyPairs() {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select({
    id: rsaKeyPairs.id,
    name: rsaKeyPairs.name,
    publicKey: rsaKeyPairs.publicKey,
    keySize: rsaKeyPairs.keySize,
    isActive: rsaKeyPairs.isActive,
    createdAt: rsaKeyPairs.createdAt,
  }).from(rsaKeyPairs).orderBy(desc(rsaKeyPairs.createdAt));
  return all;
}

/**
 * 签发"解锁码"（厂商侧）。
 * 客户端检测到时间回拨会永久锁定，需用此码（RSA-SHA256 签名）解锁。
 * 客户端用内置公钥 verifyUnlockCode 验签通过即清除锁定（见 shared/crypto-lib.cjs）。
 * 说明：当前未绑定机器码（与离线版策略一致），同一解锁码可在任意机器解锁；
 *      如需限制可在 payload 里加 machineId 并在客户端校验。
 */
export async function generateUnlockCode() {
  const keyPair = await ensureRsaKeyPair();
  if (!keyPair) throw new Error("No RSA key pair available");

  const payloadObj = {
    type: "unlock",
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString("base64");

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(payloadB64);
  sign.end();
  const signature = sign.sign(keyPair.privateKey, "base64");

  const code = Buffer.from(JSON.stringify({ payload: payloadB64, signature })).toString("base64");
  return { code, issuedAt: payloadObj.issuedAt };
}

// ===== Offline Key Helpers =====

const LICENSE_VERSION = 2;

/** 生成离线激活码（RSA-SHA256 签名） */
export async function generateOfflineActivationCode(params: {
  sensorTypes: string[] | "all";
  days: number;
  expireDate?: number;
  customerId?: number | null;
  customerName?: string | null;
  contractId?: number | null;
  contractNo?: string | null;
  createdById: number;
  createdByName: string;
  remark?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 获取活跃的 RSA 密钥对
  const keyPair = await ensureRsaKeyPair();
  if (!keyPair) throw new Error("No RSA key pair available");

  // 计算到期时间
  const expireDate = params.expireDate || (Date.now() + params.days * 24 * 60 * 60 * 1000);

  // 构造 payload（已去掉机器码绑定：离线版不再绑定具体机器）
  const payload = {
    sensorTypes: params.sensorTypes,
    expireDate,
    issuedAt: Date.now(),
    version: LICENSE_VERSION,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64");

  // RSA-SHA256 签名
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(payloadB64);
  sign.end();
  const signature = sign.sign(keyPair.privateKey, "base64");

  // 组装激活码
  const licenseObj = { payload: payloadB64, signature };
  const activationCode = Buffer.from(JSON.stringify(licenseObj)).toString("base64");

  // 存储到数据库
  const sensorTypeStr = params.sensorTypes === "all" ? "all" : params.sensorTypes.join(",");

  await db.insert(offlineKeys).values({
    machineId: "", // 已弃用：离线版不再绑定机器码，占位空串（列仍为 notNull，避免 DB 迁移）
    sensorTypes: sensorTypeStr,
    expireDate,
    days: params.days,
    activationCode,
    rsaKeyPairId: keyPair.id,
    createdById: params.createdById,
    createdByName: params.createdByName,
    customerId: params.customerId || null,
    customerName: params.customerName || null,
    contractId: params.contractId || null,
    contractNo: params.contractNo || null,
    remark: params.remark || null,
    licenseVersion: LICENSE_VERSION,
  });

  return {
    activationCode,
    sensorTypes: params.sensorTypes,
    expireDate,
    days: params.days,
  };
}

/** 获取离线密钥列表（分页） */
export async function getOfflineKeys(params: {
  userIds: number[];
  page: number;
  pageSize: number;
  search?: string;
  machineId?: string;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0, page: params.page, pageSize: params.pageSize };

  const conditions = [inArray(offlineKeys.createdById, params.userIds)];

  if (params.search) {
    conditions.push(
      or(
        like(offlineKeys.machineId, `%${params.search}%`),
        like(offlineKeys.customerName, `%${params.search}%`),
        like(offlineKeys.remark, `%${params.search}%`),
      )!
    );
  }

  if (params.machineId) {
    conditions.push(eq(offlineKeys.machineId, params.machineId));
  }

  const where = conditions.length > 1 ? and(...conditions) : conditions[0];

  const [items, totalResult] = await Promise.all([
    db.select().from(offlineKeys).where(where)
      .orderBy(desc(offlineKeys.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ count: count() }).from(offlineKeys).where(where),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/** 获取离线密钥统计 */
export async function getOfflineKeyStats(userIds: number[]) {
  const db = await getDb();
  if (!db) return { total: 0 };

  const result = await db.select({ count: count() }).from(offlineKeys)
    .where(inArray(offlineKeys.createdById, userIds));

  return { total: result[0]?.count ?? 0 };
}

// ===== Key Lifecycle Management =====

/** 记录密钥状态变更历史 */
export async function recordKeyStatusChange(data: {
  keyType: "online" | "offline";
  keyId: number;
  fromStatus: KeyStatus | null;
  toStatus: KeyStatus;
  reason?: string | null;
  actorId: number;
  actorName?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(keyStatusHistory).values({
    keyType: data.keyType,
    keyId: data.keyId,
    fromStatus: data.fromStatus || undefined,
    toStatus: data.toStatus,
    reason: data.reason || null,
    actorId: data.actorId,
    actorName: data.actorName || null,
  });
}

/** 暂停密钥 */
export async function suspendLicenseKey(keyId: number, reason: string, actorId: number, actorName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const key = await getLicenseKeyById(keyId);
  if (!key) throw new Error("密钥不存在");
  if (key.status === "REVOKED") throw new Error("已吊销的密钥无法暂停");
  if (key.status === "SUSPENDED") throw new Error("密钥已处于暂停状态");

  const fromStatus = key.status as KeyStatus;
  await db.update(licenseKeys).set({
    status: "SUSPENDED",
    suspendedAt: new Date(),
    suspendReason: reason,
  }).where(eq(licenseKeys.id, keyId));

  await recordKeyStatusChange({
    keyType: "online",
    keyId,
    fromStatus,
    toStatus: "SUSPENDED",
    reason,
    actorId,
    actorName,
  });

  return getLicenseKeyById(keyId);
}

/** 恢复密钥（从暂停状态） */
export async function restoreLicenseKey(keyId: number, reason: string, actorId: number, actorName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const key = await getLicenseKeyById(keyId);
  if (!key) throw new Error("密钥不存在");
  if (key.status !== "SUSPENDED") throw new Error("只有暂停状态的密钥可以恢复");

  // 恢复到暂停前的状态（如果已激活则恢复为 ACTIVATED，否则为 ISSUED）
  const toStatus: KeyStatus = key.isActivated ? "ACTIVATED" : "ISSUED";
  await db.update(licenseKeys).set({
    status: toStatus,
    suspendedAt: null,
    suspendReason: null,
  }).where(eq(licenseKeys.id, keyId));

  await recordKeyStatusChange({
    keyType: "online",
    keyId,
    fromStatus: "SUSPENDED",
    toStatus,
    reason,
    actorId,
    actorName,
  });

  return getLicenseKeyById(keyId);
}

/** 吊销密钥（永久作废） */
export async function revokeLicenseKey(keyId: number, reason: string, actorId: number, actorName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const key = await getLicenseKeyById(keyId);
  if (!key) throw new Error("密钥不存在");
  if (key.status === "REVOKED") throw new Error("密钥已处于吊销状态");

  const fromStatus = key.status as KeyStatus;
  await db.update(licenseKeys).set({
    status: "REVOKED",
    revokedAt: new Date(),
    revokeReason: reason,
  }).where(eq(licenseKeys.id, keyId));

  await recordKeyStatusChange({
    keyType: "online",
    keyId,
    fromStatus,
    toStatus: "REVOKED",
    reason,
    actorId,
    actorName,
  });

  return getLicenseKeyById(keyId);
}

/** 续期密钥 */
export async function renewLicenseKey(keyId: number, additionalDays: number, actorId: number, actorName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const key = await getLicenseKeyById(keyId);
  if (!key) throw new Error("密钥不存在");
  if (key.status === "REVOKED") throw new Error("已吊销的密钥无法续期");

  const fromStatus = key.status as KeyStatus;
  const previousExpire = key.expireTimestamp;
  // 从当前时间或原到期时间（取较大值）开始计算新到期时间
  const baseTime = Math.max(Date.now(), previousExpire);
  const newExpire = baseTime + additionalDays * 24 * 60 * 60 * 1000;

  await db.update(licenseKeys).set({
    status: "RENEWED",
    expireTimestamp: newExpire,
    days: key.days + additionalDays,
    renewedAt: new Date(),
    previousExpireTimestamp: previousExpire,
  }).where(eq(licenseKeys.id, keyId));

  await recordKeyStatusChange({
    keyType: "online",
    keyId,
    fromStatus,
    toStatus: "RENEWED",
    reason: `续期 ${additionalDays} 天，新到期时间: ${new Date(newExpire).toISOString()}`,
    actorId,
    actorName,
  });

  return getLicenseKeyById(keyId);
}

/** 获取密钥状态变更历史 */
export async function getKeyStatusHistoryList(keyType: "online" | "offline", keyId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(keyStatusHistory)
    .where(and(eq(keyStatusHistory.keyType, keyType), eq(keyStatusHistory.keyId, keyId)))
    .orderBy(desc(keyStatusHistory.createdAt));
}

// ===================================================================
// 防回拨：服务端权威时间高水位 + 异常密钥(TAMPERED)
// ===================================================================

/** 客户端时间回拨容差：5 分钟内的轻微倒退（NTP/时区）不算异常 */
const TAMPER_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * 记录客户端上报时间并检测回拨（在线密钥，由 /licenseCheck 调用）。
 * - 维护 lastSeenClientTime 高水位；clientTime < 高水位-容差，或客户端上报 tamper=true → 标记 TAMPERED。
 * - TAMPERED 一旦标记会持久化，需管理员清除异常后才会复位。REVOKED 的 key 不再变更。
 * @returns { tampered, status } status 为处理后的当前状态
 */
export async function recordClientTimeAndDetectTamper(params: {
  keyId: number;
  clientTime?: number;
  tamperReported?: boolean;
  serverNow?: number;
}): Promise<{ tampered: boolean; status: KeyStatus } | null> {
  const db = await getDb();
  if (!db) return null;
  const key = await getLicenseKeyById(params.keyId);
  if (!key) return null;

  const serverNow = params.serverNow ?? Date.now();
  const clientTime = typeof params.clientTime === "number" && !Number.isNaN(params.clientTime) ? params.clientTime : undefined;

  // 已吊销：服务端权威终态，不再处理
  if (key.status === "REVOKED") return { tampered: false, status: "REVOKED" };

  // 已是异常：保持异常，仅刷新检查时间，不抬高水位
  if (key.status === "TAMPERED") {
    await db.update(licenseKeys).set({ lastCheckAt: new Date(serverNow) }).where(eq(licenseKeys.id, key.id));
    return { tampered: true, status: "TAMPERED" };
  }

  const prevHW = key.lastSeenClientTime ?? 0;
  const rolledBack = clientTime !== undefined && clientTime < prevHW - TAMPER_TOLERANCE_MS;
  const detected = !!params.tamperReported || rolledBack;

  if (detected) {
    const reason = params.tamperReported
      ? "客户端上报时间异常"
      : `服务端检测时间回拨：上报 ${clientTime} < 高水位 ${prevHW}`;
    await db.update(licenseKeys).set({
      status: "TAMPERED",
      statusBeforeTamper: key.status as KeyStatus,
      tamperedAt: new Date(serverNow),
      tamperReason: reason,
      reportedClientTime: clientTime ?? null,
      tamperServerTime: serverNow,
      lastCheckAt: new Date(serverNow),
    }).where(eq(licenseKeys.id, key.id));
    await recordKeyStatusChange({
      keyType: "online",
      keyId: key.id,
      fromStatus: key.status as KeyStatus,
      toStatus: "TAMPERED",
      reason,
      actorId: 0,
      actorName: "系统(回拨检测)",
    });
    return { tampered: true, status: "TAMPERED" };
  }

  // 正常：抬高水位
  const newHW = clientTime !== undefined && clientTime > prevHW ? clientTime : prevHW;
  await db.update(licenseKeys).set({
    lastSeenClientTime: newHW,
    lastCheckAt: new Date(serverNow),
  }).where(eq(licenseKeys.id, key.id));
  return { tampered: false, status: key.status as KeyStatus };
}

/**
 * 清除异常 / 重新激活（管理员核实后）。
 * 清除 TAMPERED 标记，恢复异常前状态，并重置高水位（否则客户时钟未调回会立刻又判异常）。
 */
export async function clearKeyTamper(keyId: number, actorId: number, actorName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const key = await getLicenseKeyById(keyId);
  if (!key) throw new Error("密钥不存在");
  if (key.status !== "TAMPERED") throw new Error("该密钥不是异常状态");

  // 恢复到异常前状态；若过期则置 EXPIRED；缺失则按是否激活回退
  let toStatus: KeyStatus = (key.statusBeforeTamper as KeyStatus) || (key.isActivated ? "ACTIVATED" : "ISSUED");
  if (key.expireTimestamp < Date.now() && toStatus !== "REVOKED") toStatus = "EXPIRED";

  await db.update(licenseKeys).set({
    status: toStatus,
    statusBeforeTamper: null,
    tamperedAt: null,
    tamperReason: null,
    reportedClientTime: null,
    tamperServerTime: null,
    lastSeenClientTime: null, // 重置高水位
  }).where(eq(licenseKeys.id, keyId));

  await recordKeyStatusChange({
    keyType: "online",
    keyId,
    fromStatus: "TAMPERED",
    toStatus,
    reason: "管理员清除异常 / 重新激活",
    actorId,
    actorName,
  });
  return getLicenseKeyById(keyId);
}

/** 获取异常(TAMPERED)密钥列表（按数据域过滤） */
export async function getTamperedKeys(userIds: number[]) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(licenseKeys)
    .where(and(inArray(licenseKeys.createdById, userIds), eq(licenseKeys.status, "TAMPERED")))
    .orderBy(desc(licenseKeys.tamperedAt));
}

/** 异常密钥数量（监控用） */
export async function getTamperedKeyCount(userIds: number[]) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: count() }).from(licenseKeys)
    .where(and(inArray(licenseKeys.createdById, userIds), eq(licenseKeys.status, "TAMPERED")));
  return result[0]?.count ?? 0;
}

/**
 * 重新签发新密钥：按原密钥的传感器/天数/客户生成一把【新密文串】（ACTIVATED），
 * 默认同时把旧密钥吊销。用于异常/盗用后给客户换新 key。
 */
export async function reissueLicenseKey(keyId: number, actorId: number, actorName: string, opts?: { revokeOld?: boolean }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const old = await getLicenseKeyById(keyId);
  if (!old) throw new Error("原密钥不存在");

  // 重建传感器入参并生成新串
  const sensorsArg: string | string[] = old.sensorType === "all" ? "all" : old.sensorType.split(",");
  const newKeyString = generateLicenseKey(sensorsArg, old.days, old.category as "production" | "rental");
  const decoded = decodeLicenseKey(newKeyString);
  const expireTimestamp = decoded.expireTimestamp ?? (Date.now() + old.days * 24 * 60 * 60 * 1000);
  const keyHash = crypto.createHash("sha256").update(newKeyString).digest("hex");

  await db.insert(licenseKeys).values({
    keyString: newKeyString,
    keyHash,
    sensorType: old.sensorType,
    category: old.category,
    days: old.days,
    expireTimestamp,
    createdById: old.createdById,
    createdByName: old.createdByName,
    customerId: old.customerId,
    contractId: old.contractId,
    contractNo: old.contractNo,
    customerName: old.customerName,
    maxDevices: old.maxDevices,
    isActivated: true,
    status: "ACTIVATED",
    activatedAt: new Date(),
    remark: old.remark ? `${old.remark}（由 #${old.id} 重签）` : `由 #${old.id} 重签`,
  });
  const inserted = await db.select().from(licenseKeys).where(eq(licenseKeys.keyHash, keyHash)).orderBy(desc(licenseKeys.id)).limit(1);
  const newKey = inserted[0];

  await recordKeyStatusChange({
    keyType: "online",
    keyId: newKey.id,
    fromStatus: null,
    toStatus: "ACTIVATED",
    reason: `重新签发自 #${old.id}`,
    actorId,
    actorName,
  });

  // 默认吊销旧 key
  if (opts?.revokeOld !== false) {
    await revokeLicenseKey(old.id, `已重新签发新密钥 #${newKey.id}`, actorId, actorName);
  }

  return { newKey, oldKeyId: old.id, revokedOld: opts?.revokeOld !== false };
}

// ===== Audit Log Helpers =====

/** 写入审计日志 */
export async function createAuditLog(data: {
  userId: number;
  userName?: string | null;
  action: InsertAuditLog["action"];
  resourceType?: string | null;
  resourceId?: number | null;
  before?: unknown;
  after?: unknown;
  description?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    userId: data.userId,
    userName: data.userName || null,
    action: data.action,
    resourceType: data.resourceType || null,
    resourceId: data.resourceId || null,
    before: data.before ? JSON.stringify(data.before) : null,
    after: data.after ? JSON.stringify(data.after) : null,
    description: data.description || null,
    ip: data.ip || null,
    userAgent: data.userAgent || null,
  });
}

/** 查询审计日志（分页） */
export async function getAuditLogs(opts: {
  page: number;
  pageSize: number;
  userId?: number;
  action?: string;
  resourceType?: string;
  search?: string;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions: any[] = [];
  if (opts.userId) conditions.push(eq(auditLogs.userId, opts.userId));
  if (opts.action) conditions.push(eq(auditLogs.action, opts.action as any));
  if (opts.resourceType) conditions.push(eq(auditLogs.resourceType, opts.resourceType));
  if (opts.search) {
    conditions.push(
      or(
        like(auditLogs.userName, `%${opts.search}%`),
        like(auditLogs.description, `%${opts.search}%`)
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (opts.page - 1) * opts.pageSize;

  const [items, totalResult] = await Promise.all([
    db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(opts.pageSize).offset(offset),
    db.select({ count: count() }).from(auditLogs).where(where),
  ]);

  return { items, total: totalResult[0]?.count ?? 0 };
}

/** 密钥脱敏展示（只显示后6位） */
export function maskKeyString(keyString: string): string {
  if (keyString.length <= 6) return keyString;
  return "****" + keyString.slice(-6);
}


// ===================================================================
// 阶段二：心跳校验机制
// ===================================================================

/** 记录/更新设备心跳 */
export async function recordHeartbeat(data: {
  keyId: number;
  keyType?: "online" | "offline";
  deviceCode: string;
  clientIp?: string;
  clientVersion?: string;
}) {
  const db = await getDb();
  if (!db) return null;

  // 尝试更新已有记录
  const existing = await db.select().from(deviceHeartbeats)
    .where(and(
      eq(deviceHeartbeats.keyId, data.keyId),
      eq(deviceHeartbeats.keyType, data.keyType || "online"),
      eq(deviceHeartbeats.deviceCode, data.deviceCode),
    ))
    .limit(1);

  if (existing.length > 0) {
    await db.update(deviceHeartbeats)
      .set({
        lastHeartbeatAt: new Date(),
        heartbeatCount: sql`${deviceHeartbeats.heartbeatCount} + 1`,
        clientIp: data.clientIp || null,
        clientVersion: data.clientVersion || null,
      })
      .where(eq(deviceHeartbeats.id, existing[0].id));
    return { ...existing[0], heartbeatCount: existing[0].heartbeatCount + 1, lastHeartbeatAt: new Date() };
  }

  // 新建心跳记录
  const [result] = await db.insert(deviceHeartbeats).values({
    keyId: data.keyId,
    keyType: data.keyType || "online",
    deviceCode: data.deviceCode,
    clientIp: data.clientIp || null,
    clientVersion: data.clientVersion || null,
  });
  return { id: result.insertId, ...data, heartbeatCount: 1, lastHeartbeatAt: new Date() };
}

/** 获取密钥的心跳记录 */
export async function getKeyHeartbeats(keyId: number, keyType: "online" | "offline" = "online") {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(deviceHeartbeats)
    .where(and(
      eq(deviceHeartbeats.keyId, keyId),
      eq(deviceHeartbeats.keyType, keyType),
    ))
    .orderBy(desc(deviceHeartbeats.lastHeartbeatAt));
}

/** 获取心跳丢失的设备（超过指定小时数未心跳） */
export async function getLostHeartbeatDevices(hoursThreshold: number = 48) {
  const db = await getDb();
  if (!db) return [];
  const threshold = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);
  return db.select().from(deviceHeartbeats)
    .where(lte(deviceHeartbeats.lastHeartbeatAt, threshold));
}

// ===================================================================
// 阶段三：合同管理
// ===================================================================

/** 创建合同 */
export async function createContract(data: {
  contractNo: string;
  title: string;
  customerId?: number;
  customerName?: string;
  signDate?: string;
  startDate?: string;
  endDate?: string;
  totalKeys?: number;
  remark?: string;
  status?: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  createdById: number;
  createdByName?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(contracts).values({
    contractNo: data.contractNo,
    title: data.title,
    customerId: data.customerId || null,
    customerName: data.customerName || null,
    signDate: data.signDate ? new Date(data.signDate) : null,
    startDate: data.startDate ? new Date(data.startDate) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
    totalKeys: data.totalKeys || 0,
    remark: data.remark || null,
    createdById: data.createdById,
    createdByName: data.createdByName || null,
    status: data.status || "DRAFT",
  });
  return { id: result.insertId, ...data };
}

/** 更新合同 */
export async function updateContract(id: number, data: Partial<{
  title: string;
  customerId: number | null;
  customerName: string | null;
  signDate: string | null;
  startDate: string | null;
  endDate: string | null;
  totalKeys: number;
  status: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED";
  remark: string | null;
}>) {
  const db = await getDb();
  if (!db) return;
  await db.update(contracts).set(data as any).where(eq(contracts.id, id));
}

/** 获取合同列表 */
export async function getContracts(opts?: {
  userIds?: number[];
  customerId?: number;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const conditions: any[] = [];
  if (opts?.userIds) conditions.push(inArray(contracts.createdById, opts.userIds));
  if (opts?.customerId) conditions.push(eq(contracts.customerId, opts.customerId));
  if (opts?.status) conditions.push(eq(contracts.status, opts.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = opts?.page || 1;
  const pageSize = opts?.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const [items, totalResult] = await Promise.all([
    db.select().from(contracts).where(where).orderBy(desc(contracts.createdAt)).limit(pageSize).offset(offset),
    db.select({ count: count() }).from(contracts).where(where),
  ]);
  return { items, total: totalResult[0]?.count ?? 0 };
}

/** 获取单个合同 */
export async function getContractById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return result[0] || null;
}

/** 获取合同通过编号 */
export async function getContractByNo(contractNo: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(contracts).where(eq(contracts.contractNo, contractNo)).limit(1);
  return result[0] || null;
}

/** 增加合同已用密钥数 */
export async function incrementContractUsedKeys(contractId: number, count_: number = 1) {
  const db = await getDb();
  if (!db) return;
  await db.update(contracts).set({
    usedKeys: sql`${contracts.usedKeys} + ${count_}`,
  }).where(eq(contracts.id, contractId));
}

// ===================================================================
// 阶段三：团队管理
// ===================================================================

/** 创建团队 */
export async function createTeam(data: {
  name: string;
  description?: string;
  leaderId?: number;
  leaderName?: string;
  parentTeamId?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(teams).values({
    name: data.name,
    description: data.description || null,
    leaderId: data.leaderId || null,
    leaderName: data.leaderName || null,
    parentTeamId: data.parentTeamId || null,
  });
  return { id: result.insertId, ...data };
}

/** 更新团队 */
export async function updateTeam(id: number, data: Partial<{
  name: string;
  description: string | null;
  leaderId: number | null;
  leaderName: string | null;
  parentTeamId: number | null;
  isActive: boolean;
}>) {
  const db = await getDb();
  if (!db) return;
  await db.update(teams).set(data as any).where(eq(teams.id, id));
}

/** 获取所有团队 */
export async function getTeams(activeOnly: boolean = true) {
  const db = await getDb();
  if (!db) return [];
  if (activeOnly) {
    return db.select().from(teams).where(eq(teams.isActive, true)).orderBy(teams.name);
  }
  return db.select().from(teams).orderBy(teams.name);
}

/** 获取团队成员 */
export async function getTeamMembers(teamId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    username: users.username,
    name: users.name,
    role: users.role,
    isActive: users.isActive,
  }).from(users).where(eq(users.teamId, teamId));
}

/** 设置用户团队 */
export async function setUserTeam(userId: number, teamId: number | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ teamId }).where(eq(users.id, userId));
}

