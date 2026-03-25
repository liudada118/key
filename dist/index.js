// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { and, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import {
  bigint,
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar
} from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** 用户名（登录用，唯一） */
  username: varchar("username", { length: 64 }).notNull().unique(),
  /** 密码（bcrypt 哈希） */
  password: varchar("password", { length: 128 }).notNull(),
  /** 显示名称 */
  name: text("name"),
  email: varchar("email", { length: 320 }),
  role: mysqlEnum("role", ["user", "admin", "super_admin"]).default("user").notNull(),
  /** 创建者 ID，super_admin 为 null */
  createdById: int("createdById"),
  /** 账号是否启用 */
  isActive: boolean("isActive").default(true).notNull(),
  /** 账号备注 */
  remark: text("remark"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  /** 客户名称/公司名 */
  name: varchar("name", { length: 256 }).notNull(),
  /** 联系人 */
  contactPerson: varchar("contactPerson", { length: 128 }),
  /** 联系电话 */
  phone: varchar("phone", { length: 32 }),
  /** 邮箱 */
  email: varchar("email", { length: 320 }),
  /** 地址 */
  address: text("address"),
  /** 备注 */
  remark: text("remark"),
  /** 创建者用户 ID */
  createdById: int("createdById").notNull(),
  /** 是否启用 */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var licenseKeys = mysqlTable("licenseKeys", {
  id: int("id").autoincrement().primaryKey(),
  /** 加密后的密钥字符串 (hex) */
  keyString: text("keyString").notNull(),
  /** 传感器类型（多选时逗号分隔，或 "all"） */
  sensorType: varchar("sensorType", { length: 512 }).notNull(),
  /** 密钥类型: production(量产) / rental(在线租赁) */
  category: mysqlEnum("category", ["production", "rental"]).notNull(),
  /** 有效期天数 */
  days: int("days").notNull(),
  /** 到期时间戳 (ms) */
  expireTimestamp: bigint("expireTimestamp", { mode: "number" }).notNull(),
  /** 创建者用户 ID */
  createdById: int("createdById").notNull(),
  /** 创建者名称（冗余存储，方便查询） */
  createdByName: varchar("createdByName", { length: 128 }),
  /** 关联客户 ID */
  customerId: int("customerId"),
  /** 客户名称（冗余存储，方便查询） */
  customerName: varchar("customerName", { length: 256 }),
  /** 最大可绑定设备数量（0 表示不限制） */
  maxDevices: int("maxDevices").default(1).notNull(),
  /** 是否已激活（至少绑定了一台设备） */
  isActivated: boolean("isActivated").default(false).notNull(),
  /** 首次激活时间 */
  activatedAt: timestamp("activatedAt"),
  /** 激活设备信息（兼容旧字段，新流程使用 keyDevices 表） */
  activatedDevice: text("activatedDevice"),
  /** 批次号（批量生成时标识同一批） */
  batchId: varchar("batchId", { length: 64 }),
  /** 备注 */
  remark: text("remark"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var keyDevices = mysqlTable("keyDevices", {
  id: int("id").autoincrement().primaryKey(),
  /** 关联的密钥 ID */
  keyId: int("keyId").notNull(),
  /** 设备码（如 MAC 地址、机器码等） */
  deviceCode: varchar("deviceCode", { length: 256 }).notNull(),
  /** 设备名称/备注（可选） */
  deviceName: varchar("deviceName", { length: 256 }),
  /** 绑定时间 */
  boundAt: timestamp("boundAt").defaultNow().notNull(),
  /** 绑定时的 IP 地址（可选） */
  boundIp: varchar("boundIp", { length: 64 })
});
var sensorTypes = mysqlTable("sensorTypes", {
  id: int("id").autoincrement().primaryKey(),
  /** 显示名称（如"触觉手套"） */
  label: varchar("label", { length: 128 }).notNull(),
  /** 唯一标识符（如"hand0205"），用于加密和存储 */
  value: varchar("value", { length: 128 }).notNull().unique(),
  /** 所属分组名称（如"触觉手套"、"汽车座椅"） */
  groupName: varchar("groupName", { length: 128 }).notNull(),
  /** 分组图标（emoji） */
  groupIcon: varchar("groupIcon", { length: 16 }).default("\u{1F4E6}").notNull(),
  /** 排序顺序（同组内排序） */
  sortOrder: int("sortOrder").default(0).notNull(),
  /** 是否启用 */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var rsaKeyPairs = mysqlTable("rsaKeyPairs", {
  id: int("id").autoincrement().primaryKey(),
  /** 密钥对名称/标识 */
  name: varchar("name", { length: 128 }).notNull().default("default"),
  /** RSA 私钥 (PEM 格式) */
  privateKey: text("privateKey").notNull(),
  /** RSA 公钥 (PEM 格式) */
  publicKey: text("publicKey").notNull(),
  /** 密钥位数 */
  keySize: int("keySize").notNull().default(2048),
  /** 是否为当前使用的密钥对 */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var offlineKeys = mysqlTable("offlineKeys", {
  id: int("id").autoincrement().primaryKey(),
  /** 机器码（16位十六进制） */
  machineId: varchar("machineId", { length: 32 }).notNull(),
  /** 授权的传感器类型（逗号分隔，或 "all"） */
  sensorTypes: varchar("sensorTypes", { length: 512 }).notNull(),
  /** 到期时间戳 (ms) */
  expireDate: bigint("expireDate", { mode: "number" }).notNull(),
  /** 有效天数 */
  days: int("days").notNull(),
  /** 生成的激活码（Base64） */
  activationCode: text("activationCode").notNull(),
  /** 使用的 RSA 密钥对 ID */
  rsaKeyPairId: int("rsaKeyPairId").notNull(),
  /** 创建者用户 ID */
  createdById: int("createdById").notNull(),
  /** 创建者名称 */
  createdByName: varchar("createdByName", { length: 128 }),
  /** 关联客户 ID */
  customerId: int("customerId"),
  /** 客户名称 */
  customerName: varchar("customerName", { length: 256 }),
  /** 备注 */
  remark: text("remark"),
  /** 许可证版本 */
  licenseVersion: int("licenseVersion").notNull().default(2),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/db.ts
import crypto from "crypto";
import bcrypt from "bcryptjs";
var _db = null;
async function getDb() {
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
async function getUserByUsername(username) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getUserById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function verifyUserCredentials(username, password) {
  const user = await getUserByUsername(username);
  if (!user) return null;
  if (!user.isActive) return null;
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  const db = await getDb();
  if (db) {
    await db.update(users).set({ lastSignedIn: /* @__PURE__ */ new Date() }).where(eq(users.id, user.id));
  }
  return user;
}
async function createUserWithPassword(data) {
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
    isActive: true
  });
  const result = await db.select().from(users).where(eq(users.username, data.username)).limit(1);
  return result[0];
}
async function ensureDefaultSuperAdmin() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(users).where(eq(users.role, "super_admin")).limit(1);
  if (existing.length > 0) return;
  console.log("[Init] Creating default super admin: admin / admin123");
  await createUserWithPassword({
    username: "admin",
    password: "admin123",
    name: "\u8D85\u7EA7\u7BA1\u7406\u5458",
    role: "super_admin",
    createdById: null
  });
  console.log("[Init] Default super admin created successfully");
}
async function ensureDefaultSensorTypes() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(sensorTypes).limit(1);
  if (existing.length > 0) return;
  console.log("[Init] Creating default sensor types...");
  const defaultSensors = [
    // 常用
    { label: "\u624B\u90E8\u68C0\u6D4B", value: "hand", groupName: "\u5E38\u7528", groupIcon: "\u{1F590}\uFE0F", sortOrder: 1, isActive: true },
    // 关怀
    { label: "\u5C0F\u5E8A\u76D1\u6D4B", value: "jqbed", groupName: "\u5173\u6000", groupIcon: "\u{1F6CF}\uFE0F", sortOrder: 10, isActive: true },
    // 精密
    { label: "\u89E6\u89C9\u624B\u5957", value: "hand0205", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 20, isActive: true },
    { label: "\u89E6\u89C9\u624B\u5957(115200)", value: "handGlove115200", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 21, isActive: true },
    { label: "\u5C0F\u578B\u6837\u54C1", value: "smallSample", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 22, isActive: true },
    { label: "\u5B87\u6811G1\u89E6\u89C9\u4E0A\u8863", value: "robot1", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 23, isActive: true },
    { label: "\u677E\u5EF6N2\u89E6\u89C9\u4E0A\u8863", value: "robotSY", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 24, isActive: true },
    { label: "\u96F6\u6B21\u65B9H1\u89E6\u89C9\u4E0A\u8863", value: "robotLCF", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 25, isActive: true },
    { label: "\u89E6\u89C9\u8DB3\u5E95", value: "footVideo", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 26, isActive: true },
    { label: "14x20\u9AD8\u901F", value: "daliegu", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 27, isActive: true },
    { label: "16x16\u9AD8\u901F", value: "fast256", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 28, isActive: true },
    { label: "32x32\u9AD8\u901F", value: "fast1024", groupName: "\u7CBE\u5BC6", groupIcon: "\u{1F9E4}", sortOrder: 29, isActive: true }
  ];
  for (const sensor of defaultSensors) {
    await db.insert(sensorTypes).values(sensor);
  }
  console.log(`[Init] Created ${defaultSensors.length} default sensor types`);
}
async function changePassword(userId, newPassword) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
}
async function resetPassword(userId, newPassword) {
  return changePassword(userId, newPassword);
}
async function getSubordinateUsers(userId, role) {
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
      lastSignedIn: users.lastSignedIn
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
      lastSignedIn: users.lastSignedIn
    }).from(users).where(
      and(eq(users.createdById, userId), eq(users.role, "user"))
    ).orderBy(desc(users.createdAt));
  }
  return [];
}
async function getUserAndSubordinateIds(userId, role) {
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
async function createAccount(data) {
  return createUserWithPassword({
    username: data.username,
    password: data.password,
    name: data.name,
    role: data.role,
    createdById: data.createdById,
    remark: data.remark
  });
}
async function updateAccount(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet = {};
  if (data.name !== void 0) updateSet.name = data.name;
  if (data.isActive !== void 0) updateSet.isActive = data.isActive;
  if (data.remark !== void 0) updateSet.remark = data.remark;
  if (Object.keys(updateSet).length > 0) {
    await db.update(users).set(updateSet).where(eq(users.id, id));
  }
  return getUserById(id);
}
async function createCustomer(data) {
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
    isActive: true
  });
  const result = await db.select().from(customers).where(and(eq(customers.name, data.name), eq(customers.createdById, data.createdById))).orderBy(desc(customers.id)).limit(1);
  return result[0];
}
async function updateCustomer(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet = {};
  if (data.name !== void 0) updateSet.name = data.name;
  if (data.contactPerson !== void 0) updateSet.contactPerson = data.contactPerson;
  if (data.phone !== void 0) updateSet.phone = data.phone;
  if (data.email !== void 0) updateSet.email = data.email;
  if (data.address !== void 0) updateSet.address = data.address;
  if (data.remark !== void 0) updateSet.remark = data.remark;
  if (data.isActive !== void 0) updateSet.isActive = data.isActive;
  if (Object.keys(updateSet).length > 0) {
    await db.update(customers).set(updateSet).where(eq(customers.id, id));
  }
  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result[0];
}
async function getCustomerById(id) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getCustomers(opts) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const conditions = [inArray(customers.createdById, opts.userIds)];
  if (opts.search) {
    conditions.push(
      or(
        like(customers.name, `%${opts.search}%`),
        like(customers.contactPerson, `%${opts.search}%`),
        like(customers.phone, `%${opts.search}%`)
      )
    );
  }
  if (opts.isActive !== void 0) conditions.push(eq(customers.isActive, opts.isActive));
  const where = and(...conditions);
  const offset = (opts.page - 1) * opts.pageSize;
  const [items, totalResult] = await Promise.all([
    db.select().from(customers).where(where).orderBy(desc(customers.createdAt)).limit(opts.pageSize).offset(offset),
    db.select({ count: count() }).from(customers).where(where)
  ]);
  return { items, total: totalResult[0]?.count ?? 0 };
}
async function getAllCustomers(userIds) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: customers.id,
    name: customers.name,
    contactPerson: customers.contactPerson,
    phone: customers.phone
  }).from(customers).where(
    and(inArray(customers.createdById, userIds), eq(customers.isActive, true))
  ).orderBy(desc(customers.createdAt));
}
async function getCustomerKeyCount(customerId) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: count() }).from(licenseKeys).where(eq(licenseKeys.customerId, customerId));
  return result[0]?.count ?? 0;
}
async function insertLicenseKey(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(licenseKeys).values(data);
}
async function insertLicenseKeys(dataList) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (dataList.length === 0) return;
  await db.insert(licenseKeys).values(dataList);
}
async function getLicenseKeys(opts) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const conditions = [inArray(licenseKeys.createdById, opts.userIds)];
  if (opts.category) conditions.push(eq(licenseKeys.category, opts.category));
  if (opts.sensorType) conditions.push(like(licenseKeys.sensorType, `%${opts.sensorType}%`));
  if (opts.isActivated !== void 0) conditions.push(eq(licenseKeys.isActivated, opts.isActivated));
  if (opts.customerId) conditions.push(eq(licenseKeys.customerId, opts.customerId));
  if (opts.search) {
    conditions.push(
      or(
        like(licenseKeys.keyString, `%${opts.search}%`),
        like(licenseKeys.customerName, `%${opts.search}%`)
      )
    );
  }
  const where = and(...conditions);
  const offset = (opts.page - 1) * opts.pageSize;
  const [items, totalResult] = await Promise.all([
    db.select().from(licenseKeys).where(where).orderBy(desc(licenseKeys.createdAt)).limit(opts.pageSize).offset(offset),
    db.select({ count: count() }).from(licenseKeys).where(where)
  ]);
  return { items, total: totalResult[0]?.count ?? 0 };
}
async function getLicenseKeyByString(keyString) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(licenseKeys).where(eq(licenseKeys.keyString, keyString)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function activateLicenseKey(keyString, deviceCode, deviceName, clientIp) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getLicenseKeyByString(keyString);
  if (!existing) return { success: false, error: "\u5BC6\u94A5\u4E0D\u5B58\u5728" };
  if (existing.expireTimestamp < Date.now()) {
    return { success: false, error: "\u5BC6\u94A5\u5DF2\u8FC7\u671F" };
  }
  if (!deviceCode) {
    return { success: false, error: "\u8BBE\u5907\u7801\u4E0D\u80FD\u4E3A\u7A7A" };
  }
  const trimmedDeviceCode = deviceCode.trim();
  const existingDevice = await db.select().from(keyDevices).where(and(eq(keyDevices.keyId, existing.id), eq(keyDevices.deviceCode, trimmedDeviceCode))).limit(1);
  if (existingDevice.length > 0) {
    return { success: true, message: "\u8BE5\u8BBE\u5907\u5DF2\u7ED1\u5B9A\u6B64\u5BC6\u94A5\uFF0C\u65E0\u9700\u91CD\u590D\u6FC0\u6D3B", alreadyBound: true };
  }
  const boundDevices = await db.select({ count: count() }).from(keyDevices).where(eq(keyDevices.keyId, existing.id));
  const currentCount = boundDevices[0]?.count ?? 0;
  if (existing.maxDevices > 0 && currentCount >= existing.maxDevices) {
    return {
      success: false,
      error: `\u8BBE\u5907\u7ED1\u5B9A\u6570\u91CF\u5DF2\u8FBE\u4E0A\u9650\uFF08${existing.maxDevices}\u53F0\uFF09`,
      currentDevices: currentCount,
      maxDevices: existing.maxDevices
    };
  }
  await db.insert(keyDevices).values({
    keyId: existing.id,
    deviceCode: trimmedDeviceCode,
    deviceName: deviceName || null,
    boundIp: clientIp || null
  });
  if (!existing.isActivated) {
    await db.update(licenseKeys).set({
      isActivated: true,
      activatedAt: /* @__PURE__ */ new Date(),
      activatedDevice: trimmedDeviceCode
    }).where(eq(licenseKeys.id, existing.id));
  }
  return {
    success: true,
    message: "\u8BBE\u5907\u7ED1\u5B9A\u6210\u529F",
    currentDevices: currentCount + 1,
    maxDevices: existing.maxDevices
  };
}
async function getKeyDevices(keyId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(keyDevices).where(eq(keyDevices.keyId, keyId)).orderBy(desc(keyDevices.boundAt));
}
async function getKeyDeviceCount(keyId) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: count() }).from(keyDevices).where(eq(keyDevices.keyId, keyId));
  return result[0]?.count ?? 0;
}
async function unbindKeyDevice(keyId, deviceId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(keyDevices).where(
    and(eq(keyDevices.keyId, keyId), eq(keyDevices.id, deviceId))
  );
  const remaining = await getKeyDeviceCount(keyId);
  if (remaining === 0) {
    await db.update(licenseKeys).set({
      isActivated: false,
      activatedAt: null,
      activatedDevice: null
    }).where(eq(licenseKeys.id, keyId));
  }
  return { success: true, remainingDevices: remaining };
}
async function getKeyStats(userIds) {
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
    )
  ]);
  return {
    total: totalResult[0]?.count ?? 0,
    activated: activatedResult[0]?.count ?? 0,
    production: productionResult[0]?.count ?? 0,
    rental: rentalResult[0]?.count ?? 0,
    expired: expiredResult[0]?.count ?? 0
  };
}
async function updateLicenseKeyCategory(keyId, category) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(licenseKeys).set({ category }).where(eq(licenseKeys.id, keyId));
  const result = await db.select().from(licenseKeys).where(eq(licenseKeys.id, keyId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getLicenseKeyById(keyId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(licenseKeys).where(eq(licenseKeys.id, keyId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getSensorTypesGrouped() {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select().from(sensorTypes).where(eq(sensorTypes.isActive, true)).orderBy(sensorTypes.sortOrder);
  const groupMap = /* @__PURE__ */ new Map();
  for (const s of all) {
    if (!groupMap.has(s.groupName)) {
      groupMap.set(s.groupName, { group: s.groupName, icon: s.groupIcon, items: [] });
    }
    groupMap.get(s.groupName).items.push({ label: s.label, value: s.value, id: s.id });
  }
  return Array.from(groupMap.values());
}
async function getAllSensorTypes() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sensorTypes).orderBy(sensorTypes.sortOrder);
}
async function addSensorType(data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(sensorTypes).where(eq(sensorTypes.value, data.value)).limit(1);
  if (existing.length > 0) throw new Error("\u4F20\u611F\u5668\u6807\u8BC6\u7B26\u5DF2\u5B58\u5728");
  let order = data.sortOrder ?? 0;
  if (!data.sortOrder) {
    const maxResult = await db.select({ max: sql`MAX(${sensorTypes.sortOrder})` }).from(sensorTypes).where(eq(sensorTypes.groupName, data.groupName));
    order = (maxResult[0]?.max ?? 0) + 1;
  }
  await db.insert(sensorTypes).values({
    label: data.label,
    value: data.value,
    groupName: data.groupName,
    groupIcon: data.groupIcon || "\u{1F4E6}",
    sortOrder: order,
    isActive: true
  });
  const result = await db.select().from(sensorTypes).where(eq(sensorTypes.value, data.value)).limit(1);
  return result[0];
}
async function deleteSensorType(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sensorTypes).set({ isActive: false }).where(eq(sensorTypes.id, id));
}
async function restoreSensorType(id) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(sensorTypes).set({ isActive: true }).where(eq(sensorTypes.id, id));
}
async function updateSensorType(id, data) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet = {};
  if (data.label !== void 0) updateSet.label = data.label;
  if (data.groupName !== void 0) updateSet.groupName = data.groupName;
  if (data.groupIcon !== void 0) updateSet.groupIcon = data.groupIcon;
  if (data.sortOrder !== void 0) updateSet.sortOrder = data.sortOrder;
  if (Object.keys(updateSet).length > 0) {
    await db.update(sensorTypes).set(updateSet).where(eq(sensorTypes.id, id));
  }
  const result = await db.select().from(sensorTypes).where(eq(sensorTypes.id, id)).limit(1);
  return result[0];
}
async function getSensorGroups() {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select({
    groupName: sensorTypes.groupName,
    groupIcon: sensorTypes.groupIcon
  }).from(sensorTypes).groupBy(sensorTypes.groupName, sensorTypes.groupIcon);
  return all;
}
async function getAllUsers() {
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
    lastSignedIn: users.lastSignedIn
  }).from(users).orderBy(desc(users.createdAt));
}
async function generateAndStoreRsaKeyPair(name = "default", keySize = 2048) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: keySize,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  await db.update(rsaKeyPairs).set({ isActive: false });
  await db.insert(rsaKeyPairs).values({
    name,
    privateKey,
    publicKey,
    keySize,
    isActive: true
  });
  const result = await db.select().from(rsaKeyPairs).where(eq(rsaKeyPairs.isActive, true)).limit(1);
  return result[0];
}
async function getActiveRsaKeyPair() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(rsaKeyPairs).where(eq(rsaKeyPairs.isActive, true)).limit(1);
  return result.length > 0 ? result[0] : null;
}
async function importRsaKeyPair(name, privateKeyPem, publicKeyPem, keySize = 2048) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(rsaKeyPairs).set({ isActive: false });
  await db.insert(rsaKeyPairs).values({
    name,
    privateKey: privateKeyPem,
    publicKey: publicKeyPem,
    keySize,
    isActive: true
  });
  const result = await db.select().from(rsaKeyPairs).where(eq(rsaKeyPairs.isActive, true)).limit(1);
  return result[0];
}
var DEFAULT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
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
var DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0xly+Gg/8LvoWV0VRO/k
l1dEQRt7N6yilC2yiza+W1V2aXWKoiLlkPcJa9KQmNArjcHq8nBLlEppHjwEm2u5
SrgADP/frf1n8GZpRejZo6Ab1psppUm/neVcoxsK+0z6a00B9syv8AEIt2jrN4ZZ
zz51MgJqzgXmqPaibtzGl8RFr1jYJ2JpXNes6BqFpjQng1S8hu4VgWBIljkE3jKF
fHwTP9KPtEcoH/uSPmW5X7IuwpDW2QO6sO61uv/luLI4Wx4upX4CIUepwIzDyG6B
fYx2AAZJ1oNEBW28wIUf7i5sVT0FsWRsR55Q3KUcsiqAUVduKiKTQN3dnmbyC1Fg
AQIDAQAB
-----END PUBLIC KEY-----`;
async function ensureRsaKeyPair() {
  const existing = await getActiveRsaKeyPair();
  if (existing) {
    const existingPubNorm = existing.publicKey.replace(/\s/g, "");
    const defaultPubNorm = DEFAULT_PUBLIC_KEY.replace(/\s/g, "");
    if (existingPubNorm === defaultPubNorm) {
      return existing;
    }
    console.log("[Init] RSA key pair mismatch, replacing with default key pair...");
    return importRsaKeyPair("default", DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, 2048);
  }
  console.log("[Init] Importing default RSA key pair...");
  return importRsaKeyPair("default", DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY, 2048);
}
async function getAllRsaKeyPairs() {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select({
    id: rsaKeyPairs.id,
    name: rsaKeyPairs.name,
    publicKey: rsaKeyPairs.publicKey,
    keySize: rsaKeyPairs.keySize,
    isActive: rsaKeyPairs.isActive,
    createdAt: rsaKeyPairs.createdAt
  }).from(rsaKeyPairs).orderBy(desc(rsaKeyPairs.createdAt));
  return all;
}
var LICENSE_VERSION = 2;
async function generateOfflineActivationCode(params) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const keyPair = await ensureRsaKeyPair();
  if (!keyPair) throw new Error("No RSA key pair available");
  const expireDate = params.expireDate || Date.now() + params.days * 24 * 60 * 60 * 1e3;
  const payload = {
    machineId: params.machineId,
    sensorTypes: params.sensorTypes,
    expireDate,
    issuedAt: Date.now(),
    version: LICENSE_VERSION
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(payloadB64);
  sign.end();
  const signature = sign.sign(keyPair.privateKey, "base64");
  const licenseObj = { payload: payloadB64, signature };
  const activationCode = Buffer.from(JSON.stringify(licenseObj)).toString("base64");
  const sensorTypeStr = params.sensorTypes === "all" ? "all" : params.sensorTypes.join(",");
  await db.insert(offlineKeys).values({
    machineId: params.machineId,
    sensorTypes: sensorTypeStr,
    expireDate,
    days: params.days,
    activationCode,
    rsaKeyPairId: keyPair.id,
    createdById: params.createdById,
    createdByName: params.createdByName,
    customerId: params.customerId || null,
    customerName: params.customerName || null,
    remark: params.remark || null,
    licenseVersion: LICENSE_VERSION
  });
  return {
    activationCode,
    machineId: params.machineId,
    sensorTypes: params.sensorTypes,
    expireDate,
    days: params.days
  };
}
async function getOfflineKeys(params) {
  const db = await getDb();
  if (!db) return { items: [], total: 0, page: params.page, pageSize: params.pageSize };
  const conditions = [inArray(offlineKeys.createdById, params.userIds)];
  if (params.search) {
    conditions.push(
      or(
        like(offlineKeys.machineId, `%${params.search}%`),
        like(offlineKeys.customerName, `%${params.search}%`),
        like(offlineKeys.remark, `%${params.search}%`)
      )
    );
  }
  if (params.machineId) {
    conditions.push(eq(offlineKeys.machineId, params.machineId));
  }
  const where = conditions.length > 1 ? and(...conditions) : conditions[0];
  const [items, totalResult] = await Promise.all([
    db.select().from(offlineKeys).where(where).orderBy(desc(offlineKeys.createdAt)).limit(params.pageSize).offset((params.page - 1) * params.pageSize),
    db.select({ count: count() }).from(offlineKeys).where(where)
  ]);
  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page: params.page,
    pageSize: params.pageSize
  };
}
async function getOfflineKeyStats(userIds) {
  const db = await getDb();
  if (!db) return { total: 0 };
  const result = await db.select({ count: count() }).from(offlineKeys).where(inArray(offlineKeys.createdById, userIds));
  return { total: result[0]?.count ?? 0 };
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure
  };
}

// server/_core/sdk.ts
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";

// server/_core/env.ts
var ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "default-jwt-secret-change-me",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // 以下为可选变量
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/_core/sdk.ts
var AuthService = class {
  jwtSecret;
  constructor() {
    const secret = ENV.cookieSecret || "default-jwt-secret-change-me";
    this.jwtSecret = new TextEncoder().encode(secret);
  }
  /** 创建 JWT session token */
  async createSessionToken(userId, opts) {
    const payload = {
      userId,
      username: opts.username,
      name: opts.name
    };
    const token = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(Date.now() + opts.expiresInMs).sign(this.jwtSecret);
    return token;
  }
  /** 验证 JWT token 并返回 payload */
  async verifyToken(token) {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret);
      return payload;
    } catch {
      return null;
    }
  }
  /** 从请求中认证用户 */
  async authenticateRequest(req) {
    const rawCookies = req.headers.cookie;
    if (!rawCookies) return null;
    const cookies = parseCookieHeader(rawCookies);
    const sessionCookie = cookies[COOKIE_NAME];
    if (!sessionCookie) return null;
    const payload = await this.verifyToken(sessionCookie);
    if (!payload) return null;
    const user = await getUserById(payload.userId);
    if (!user) return null;
    if (!user.isActive) return null;
    return user;
  }
};
var sdk = new AuthService();

// server/_core/oauth.ts
function registerOAuthRoutes(app) {
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "\u7528\u6237\u540D\u548C\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A" });
        return;
      }
      const user = await verifyUserCredentials(username, password);
      if (!user) {
        res.status(401).json({ error: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF" });
        return;
      }
      if (!user.isActive) {
        res.status(403).json({ error: "\u8D26\u53F7\u5DF2\u88AB\u7981\u7528" });
        return;
      }
      const sessionToken = await sdk.createSessionToken(user.id, {
        username: user.username,
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role
        }
      });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "\u767B\u5F55\u5931\u8D25" });
    }
  });
  app.get("/api/oauth/callback", (_req, res) => {
    res.redirect(302, "/login");
  });
}

// server/routers.ts
import { z as z2 } from "zod";
import { nanoid } from "nanoid";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.user.isActive === false) {
    throw new TRPCError2({ code: "FORBIDDEN", message: "\u8D26\u53F7\u5DF2\u88AB\u7981\u7528" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var superAdminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "super_admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: "\u9700\u8981\u8D85\u7EA7\u7BA1\u7406\u5458\u6743\u9650" });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin" && ctx.user.role !== "super_admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// shared/crypto.ts
import CryptoJS from "crypto-js";
var PASSPHRASE = "JIANXINGZHE-KEY-MANAGER-2026";
function deriveKey() {
  return CryptoJS.SHA256(PASSPHRASE);
}
function aesEncrypt(plaintext) {
  const key = deriveKey();
  const iv = CryptoJS.lib.WordArray.random(12);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CTR,
    padding: CryptoJS.pad.NoPadding
  });
  const ciphertext = encrypted.ciphertext.toString();
  const ivHex = iv.toString();
  const authTag = CryptoJS.HmacSHA256(ivHex + ciphertext, key).toString().substring(0, 32);
  return ivHex + authTag + ciphertext;
}
function aesDecrypt(hexStr) {
  try {
    if (!hexStr || hexStr.length < 58) return null;
    const key = deriveKey();
    const ivHex = hexStr.substring(0, 24);
    const authTag = hexStr.substring(24, 56);
    const ciphertext = hexStr.substring(56);
    const expectedTag = CryptoJS.HmacSHA256(ivHex + ciphertext, key).toString().substring(0, 32);
    if (authTag !== expectedTag) return null;
    const iv = CryptoJS.enc.Hex.parse(ivHex);
    const ciphertextWA = CryptoJS.enc.Hex.parse(ciphertext);
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: ciphertextWA
    });
    const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
      iv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding
    });
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    return result || null;
  } catch {
    return null;
  }
}
var SENSOR_GROUPS = [
  {
    group: "\u89E6\u89C9\u624B\u5957",
    icon: "\u{1F9E4}",
    items: [
      { label: "\u89E6\u89C9\u624B\u5957", value: "hand0205" },
      { label: "\u624B\u5957\u6A21\u578B", value: "hand0507" },
      { label: "\u624B\u595796", value: "gloves" },
      { label: "\u5DE6\u624B\u624B\u5957", value: "gloves1" },
      { label: "\u53F3\u624B\u624B\u5957", value: "gloves2" },
      { label: "\u624B\u5957\u89E6\u89C9", value: "hand0205Point" },
      { label: "\u624B\u5957\u89E6\u89C9147", value: "hand0205Point147" },
      { label: "\u624B\u90E8\u68C0\u6D4B", value: "newHand" }
    ]
  },
  {
    group: "\u673A\u5668\u4EBA\u89E6\u89C9",
    icon: "\u{1F916}",
    items: [
      { label: "\u5B87\u6811G1\u89E6\u89C9\u4E0A\u8863", value: "robot1" },
      { label: "\u677E\u5EF6N2\u89E6\u89C9\u4E0A\u8863", value: "robotSY" },
      { label: "\u96F6\u6B21\u65B9H1\u89E6\u89C9\u4E0A\u8863", value: "robotLCF" },
      { label: "\u673A\u5668\u4EBA", value: "robot0428" },
      { label: "\u673A\u5668\u4EBA\u51FA\u624B", value: "robot" }
    ]
  },
  {
    group: "\u8DB3\u5E95\u68C0\u6D4B",
    icon: "\u{1F9B6}",
    items: [
      { label: "\u89E6\u89C9\u8DB3\u5E95", value: "footVideo" },
      { label: "\u811A\u578B\u68C0\u6D4B", value: "foot" },
      { label: "256\u978B\u57AB", value: "footVideo256" }
    ]
  },
  {
    group: "\u9AD8\u901F\u77E9\u9635",
    icon: "\u26A1",
    items: [
      { label: "16\xD716\u9AD8\u901F", value: "fast256" },
      { label: "32\xD732\u9AD8\u901F", value: "fast1024" },
      { label: "1024\u9AD8\u901F\u5EA7\u6905", value: "fast1024sit" },
      { label: "14\xD720\u9AD8\u901F", value: "daliegu" },
      { label: "\u5C0F\u578B\u6837\u54C1", value: "smallSample" }
    ]
  },
  {
    group: "\u6C7D\u8F66\u5EA7\u6905",
    icon: "\u{1F697}",
    items: [
      { label: "\u6C7D\u8F66\u5EA7\u6905", value: "car" },
      { label: "\u6C7D\u8F66\u9760\u80CC(\u91CF\u4EA7)", value: "car10" },
      { label: "\u6C83\u5C14\u6C83", value: "volvo" },
      { label: "\u6E05\u95F2\u6905\u5B50", value: "carQX" },
      { label: "\u8F6E\u6905", value: "yanfeng10" },
      { label: "\u6C99\u53D1", value: "sofa" },
      { label: "car100", value: "car100" },
      { label: "\u8F66\u8F7D\u4F20\u611F\u5668", value: "carCol" }
    ]
  },
  {
    group: "\u5E8A\u57AB\u76D1\u6D4B",
    icon: "\u{1F6CF}\uFE0F",
    items: [
      { label: "\u5E8A\u57AB\u76D1\u6D4B", value: "bigBed" },
      { label: "\u5C0F\u5E8A\u76D1\u6D4B", value: "jqbed" },
      { label: "\u5E2D\u60A61.0", value: "smallBed" },
      { label: "\u5E2D\u60A62.0", value: "xiyueReal1" },
      { label: "\u5C0F\u5E8A128", value: "smallBed1" },
      { label: "4096", value: "bed4096" },
      { label: "4096\u6570\u5B57", value: "bed4096num" },
      { label: "256", value: "bed1616" }
    ]
  },
  {
    group: "\u5176\u4ED6",
    icon: "\u{1F4E6}",
    items: [
      { label: "\u773C\u7F69", value: "eye" },
      { label: "\u5E2D\u60A6\u5EA7\u6905", value: "sit10" },
      { label: "\u5C0F\u77E9\u96351", value: "smallM" },
      { label: "\u77E9\u96352", value: "rect" },
      { label: "T-short", value: "short" },
      { label: "\u5510\u7FA4\u5EA7\u6905", value: "CarTq" },
      { label: "\u6B63\u5E38\u6D4B\u8BD5", value: "normal" },
      { label: "\u6E05\u95F2", value: "ware" },
      { label: "\u6E05\u95F2\u6905", value: "chairQX" },
      { label: "3D\u6570\u5B57", value: "Num3D" },
      { label: "\u672C\u5730\u81EA\u9002\u5E94", value: "localCar" },
      { label: "\u624B\u90E8\u89C6\u9891", value: "handVideo" },
      { label: "\u624B\u90E8\u89C6\u98911", value: "handVideo1" },
      { label: "\u624B\u90E8\u68C0\u6D4B(\u84DD)", value: "handBlue" },
      { label: "\u5EA7\u6905\u91C7\u96C6", value: "sitCol" },
      { label: "\u5C0F\u5E8A\u8925\u91C7\u96C6", value: "matCol" },
      { label: "\u5C0F\u5E8A\u7761\u59FF\u91C7\u96C6", value: "matColPos" }
    ]
  }
];
var ALL_SENSORS = SENSOR_GROUPS.flatMap((g) => [...g.items]);
var SENSOR_LABEL_MAP = Object.fromEntries(
  ALL_SENSORS.map((s) => [s.value, s.label])
);
var SENSOR_TYPES = [
  ...ALL_SENSORS,
  { label: "\u5168\u90E8\u7C7B\u578B", value: "all" }
];
var KEY_CATEGORIES = [
  { label: "\u91CF\u4EA7\u5BC6\u94A5", value: "production" },
  { label: "\u5728\u7EBF\u79DF\u8D41\u5BC6\u94A5", value: "rental" }
];
function generateLicenseKey(sensorTypes2, days, category = "production") {
  const expireTimestamp = Date.now() + days * 24 * 60 * 60 * 1e3;
  let file;
  if (sensorTypes2 === "all") {
    file = "all";
  } else if (Array.isArray(sensorTypes2)) {
    file = sensorTypes2.length === 1 ? sensorTypes2[0] : sensorTypes2;
  } else {
    file = sensorTypes2;
  }
  const payload = JSON.stringify({
    date: expireTimestamp,
    file,
    cat: category,
    v: 2
  });
  return aesEncrypt(payload);
}
function decodeLicenseKey(hexKey) {
  try {
    const plaintext = aesDecrypt(hexKey.trim());
    if (!plaintext) {
      return { valid: false, error: "\u89E3\u5BC6\u5931\u8D25\uFF1A\u65E0\u6548\u7684\u5BC6\u94A5\u6216\u5BC6\u94A5\u5DF2\u88AB\u7BE1\u6539" };
    }
    const parsed = JSON.parse(plaintext);
    if (!parsed.date || !parsed.file) {
      return { valid: false, error: "\u89E3\u5BC6\u5931\u8D25\uFF1A\u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5" };
    }
    const expireTimestamp = parseFloat(parsed.date);
    const now = Date.now();
    const remainingMs = expireTimestamp - now;
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1e3));
    const expireDate = new Date(expireTimestamp).toISOString();
    let sensorType;
    let sensorTypes2;
    let isAllTypes = false;
    if (parsed.file === "all") {
      isAllTypes = true;
      sensorType = "all";
      sensorTypes2 = ALL_SENSORS.map((s) => s.value);
    } else if (Array.isArray(parsed.file)) {
      sensorTypes2 = parsed.file;
      sensorType = parsed.file.join(",");
    } else {
      sensorType = parsed.file;
      sensorTypes2 = [parsed.file];
    }
    return {
      valid: remainingDays > 0,
      expireTimestamp,
      sensorType,
      sensorTypes: sensorTypes2,
      isAllTypes,
      category: parsed.cat || "production",
      expireDate,
      remainingDays,
      version: parsed.v || 1
    };
  } catch {
    return { valid: false, error: "\u89E3\u5BC6\u5931\u8D25\uFF1A\u5BC6\u94A5\u683C\u5F0F\u9519\u8BEF" };
  }
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => {
      if (!opts.ctx.user) return null;
      const { password, ...safeUser } = opts.ctx.user;
      return safeUser;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    }),
    /** 修改自己的密码 */
    changePassword: protectedProcedure.input(
      z2.object({
        oldPassword: z2.string().min(1, "\u65E7\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A"),
        newPassword: z2.string().min(6, "\u65B0\u5BC6\u7801\u81F3\u5C116\u4F4D")
      })
    ).mutation(async ({ ctx, input }) => {
      const user = await verifyUserCredentials(ctx.user.username, input.oldPassword);
      if (!user) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u65E7\u5BC6\u7801\u9519\u8BEF" });
      }
      await changePassword(ctx.user.id, input.newPassword);
      return { success: true };
    })
  }),
  // ===== 账号管理 =====
  accounts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getSubordinateUsers(ctx.user.id, ctx.user.role);
    }),
    all: superAdminProcedure.query(async () => {
      return getAllUsers();
    }),
    create: adminProcedure.input(
      z2.object({
        username: z2.string().min(2, "\u7528\u6237\u540D\u81F3\u5C112\u4E2A\u5B57\u7B26").max(32),
        password: z2.string().min(6, "\u5BC6\u7801\u81F3\u5C116\u4F4D"),
        name: z2.string().min(1, "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A"),
        role: z2.enum(["admin", "user"]),
        remark: z2.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      if (ctx.user.role === "admin" && input.role === "admin") {
        throw new TRPCError3({ code: "FORBIDDEN", message: "\u7BA1\u7406\u5458\u53EA\u80FD\u521B\u5EFA\u5B50\u8D26\u53F7" });
      }
      const existing = await getUserByUsername(input.username);
      if (existing) {
        throw new TRPCError3({ code: "CONFLICT", message: "\u7528\u6237\u540D\u5DF2\u5B58\u5728" });
      }
      return createAccount({
        username: input.username,
        password: input.password,
        name: input.name,
        role: input.role,
        createdById: ctx.user.id,
        remark: input.remark
      });
    }),
    update: adminProcedure.input(
      z2.object({
        id: z2.number(),
        name: z2.string().optional(),
        isActive: z2.boolean().optional(),
        remark: z2.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const target = await getUserById(input.id);
      if (!target) throw new TRPCError3({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
      if (ctx.user.role === "admin") {
        if (target.createdById !== ctx.user.id) {
          throw new TRPCError3({ code: "FORBIDDEN", message: "\u65E0\u6743\u64CD\u4F5C\u6B64\u8D26\u53F7" });
        }
      }
      if (ctx.user.role !== "super_admin" && target.role === "super_admin") {
        throw new TRPCError3({ code: "FORBIDDEN", message: "\u65E0\u6743\u64CD\u4F5C\u8D85\u7EA7\u7BA1\u7406\u5458" });
      }
      return updateAccount(input.id, {
        name: input.name,
        isActive: input.isActive,
        remark: input.remark
      });
    }),
    /** 重置下级账号密码（管理员操作） */
    resetPassword: adminProcedure.input(
      z2.object({
        id: z2.number(),
        newPassword: z2.string().min(6, "\u5BC6\u7801\u81F3\u5C116\u4F4D")
      })
    ).mutation(async ({ ctx, input }) => {
      const target = await getUserById(input.id);
      if (!target) throw new TRPCError3({ code: "NOT_FOUND", message: "\u8D26\u53F7\u4E0D\u5B58\u5728" });
      if (ctx.user.role === "admin") {
        if (target.createdById !== ctx.user.id) {
          throw new TRPCError3({ code: "FORBIDDEN", message: "\u65E0\u6743\u64CD\u4F5C\u6B64\u8D26\u53F7" });
        }
      }
      if (ctx.user.role !== "super_admin" && target.role === "super_admin") {
        throw new TRPCError3({ code: "FORBIDDEN", message: "\u65E0\u6743\u64CD\u4F5C\u8D85\u7EA7\u7BA1\u7406\u5458" });
      }
      await resetPassword(input.id, input.newPassword);
      return { success: true };
    })
  }),
  // ===== 客户管理 =====
  customers: router({
    list: protectedProcedure.input(
      z2.object({
        page: z2.number().min(1).default(1),
        pageSize: z2.number().min(1).max(100).default(20),
        search: z2.string().optional(),
        isActive: z2.boolean().optional()
      })
    ).query(async ({ ctx, input }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getCustomers({
        userIds,
        page: input.page,
        pageSize: input.pageSize,
        search: input.search,
        isActive: input.isActive
      });
    }),
    all: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getAllCustomers(userIds);
    }),
    get: protectedProcedure.input(z2.object({ id: z2.number() })).query(async ({ input }) => {
      const customer = await getCustomerById(input.id);
      if (!customer) throw new TRPCError3({ code: "NOT_FOUND", message: "\u5BA2\u6237\u4E0D\u5B58\u5728" });
      const keyCount = await getCustomerKeyCount(input.id);
      return { ...customer, keyCount };
    }),
    create: protectedProcedure.input(
      z2.object({
        name: z2.string().min(1, "\u5BA2\u6237\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A"),
        contactPerson: z2.string().optional(),
        phone: z2.string().optional(),
        email: z2.string().optional(),
        address: z2.string().optional(),
        remark: z2.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      return createCustomer({
        name: input.name,
        contactPerson: input.contactPerson,
        phone: input.phone,
        email: input.email,
        address: input.address,
        remark: input.remark,
        createdById: ctx.user.id
      });
    }),
    update: protectedProcedure.input(
      z2.object({
        id: z2.number(),
        name: z2.string().optional(),
        contactPerson: z2.string().optional(),
        phone: z2.string().optional(),
        email: z2.string().optional(),
        address: z2.string().optional(),
        remark: z2.string().optional(),
        isActive: z2.boolean().optional()
      })
    ).mutation(async ({ input }) => {
      const existing = await getCustomerById(input.id);
      if (!existing) throw new TRPCError3({ code: "NOT_FOUND", message: "\u5BA2\u6237\u4E0D\u5B58\u5728" });
      return updateCustomer(input.id, {
        name: input.name,
        contactPerson: input.contactPerson,
        phone: input.phone,
        email: input.email,
        address: input.address,
        remark: input.remark,
        isActive: input.isActive
      });
    })
  }),
  // ===== 传感器类型管理 =====
  sensors: router({
    /** 获取分组传感器类型（仅启用的） */
    groups: publicProcedure.query(async () => {
      return getSensorTypesGrouped();
    }),
    /** 获取所有传感器类型（包括禁用的，管理用） */
    all: superAdminProcedure.query(async () => {
      return getAllSensorTypes();
    }),
    /** 获取所有分组名称 */
    groupNames: publicProcedure.query(async () => {
      return getSensorGroups();
    }),
    /** 添加传感器类型 */
    add: superAdminProcedure.input(
      z2.object({
        label: z2.string().min(1, "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A"),
        value: z2.string().min(1, "\u6807\u8BC6\u7B26\u4E0D\u80FD\u4E3A\u7A7A").regex(/^[a-zA-Z0-9_]+$/, "\u6807\u8BC6\u7B26\u53EA\u80FD\u5305\u542B\u82F1\u6587\u3001\u6570\u5B57\u548C\u4E0B\u5212\u7EBF"),
        groupName: z2.string().min(1, "\u5206\u7EC4\u540D\u4E0D\u80FD\u4E3A\u7A7A"),
        groupIcon: z2.string().optional()
      })
    ).mutation(async ({ input }) => {
      return addSensorType(input);
    }),
    /** 删除传感器类型（软删除） */
    delete: superAdminProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await deleteSensorType(input.id);
      return { success: true };
    }),
    /** 恢复传感器类型 */
    restore: superAdminProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await restoreSensorType(input.id);
      return { success: true };
    }),
    /** 更新传感器类型 */
    update: superAdminProcedure.input(
      z2.object({
        id: z2.number(),
        label: z2.string().optional(),
        groupName: z2.string().optional(),
        groupIcon: z2.string().optional(),
        sortOrder: z2.number().optional()
      })
    ).mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateSensorType(id, data);
    })
  }),
  // ===== 离线密钥管理 =====
  offlineKeys: router({
    /** 生成离线激活码 */
    generate: protectedProcedure.input(
      z2.object({
        machineId: z2.string().length(16, "\u673A\u5668\u7801\u5FC5\u987B\u4E3A16\u4F4D"),
        sensorTypes: z2.union([z2.literal("all"), z2.array(z2.string().min(1))]),
        days: z2.number().min(1).max(36500),
        customerId: z2.number().optional(),
        customerName: z2.string().optional(),
        remark: z2.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      let customerName = input.customerName || null;
      if (input.customerId && !customerName) {
        const customer = await getCustomerById(input.customerId);
        customerName = customer?.name || null;
      }
      return generateOfflineActivationCode({
        machineId: input.machineId.toUpperCase(),
        sensorTypes: input.sensorTypes,
        days: input.days,
        customerId: input.customerId || null,
        customerName,
        createdById: ctx.user.id,
        createdByName: ctx.user.name || "\u672A\u77E5",
        remark: input.remark || null
      });
    }),
    /** 离线密钥列表 */
    list: protectedProcedure.input(
      z2.object({
        page: z2.number().min(1).default(1),
        pageSize: z2.number().min(1).max(100).default(20),
        search: z2.string().optional(),
        machineId: z2.string().optional()
      })
    ).query(async ({ ctx, input }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getOfflineKeys({
        userIds,
        page: input.page,
        pageSize: input.pageSize,
        search: input.search,
        machineId: input.machineId
      });
    }),
    /** 离线密钥统计 */
    stats: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getOfflineKeyStats(userIds);
    }),
    /** 获取公钥（供客户端下载） */
    publicKey: publicProcedure.query(async () => {
      const keyPair = await getActiveRsaKeyPair();
      if (!keyPair) return null;
      return { publicKey: keyPair.publicKey, keySize: keyPair.keySize, name: keyPair.name };
    }),
    /** RSA 密钥对管理（超级管理员） */
    rsaKeyPairs: superAdminProcedure.query(async () => {
      return getAllRsaKeyPairs();
    }),
    /** 生成新的 RSA 密钥对（超级管理员） */
    generateRsaKeyPair: superAdminProcedure.input(
      z2.object({
        name: z2.string().min(1, "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A").default("default"),
        keySize: z2.number().min(2048).max(4096).default(2048)
      })
    ).mutation(async ({ input }) => {
      const keyPair = await generateAndStoreRsaKeyPair(input.name, input.keySize);
      return { id: keyPair.id, name: keyPair.name, keySize: keyPair.keySize, publicKey: keyPair.publicKey };
    })
  }),
  // ===== 密钥管理 =====
  keys: router({
    categories: publicProcedure.query(() => KEY_CATEGORIES),
    generate: protectedProcedure.input(
      z2.object({
        sensorTypes: z2.union([z2.string(), z2.array(z2.string())]),
        days: z2.number().min(1).max(36500),
        category: z2.enum(["production", "rental"]),
        maxDevices: z2.number().min(0).max(9999).default(1),
        customerId: z2.number().optional(),
        customerName: z2.string().optional(),
        remark: z2.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const keyString = generateLicenseKey(input.sensorTypes, input.days, input.category);
      const expireTimestamp = Date.now() + input.days * 24 * 60 * 60 * 1e3;
      const sensorTypeStr = Array.isArray(input.sensorTypes) ? input.sensorTypes.join(",") : input.sensorTypes;
      let customerName = input.customerName || null;
      if (input.customerId && !customerName) {
        const customer = await getCustomerById(input.customerId);
        customerName = customer?.name || null;
      }
      await insertLicenseKey({
        keyString,
        sensorType: sensorTypeStr,
        category: input.category,
        days: input.days,
        expireTimestamp,
        maxDevices: input.maxDevices,
        createdById: ctx.user.id,
        createdByName: ctx.user.name || "\u672A\u77E5",
        customerId: input.customerId || null,
        customerName,
        remark: input.remark || null
      });
      return { keyString, expireTimestamp, maxDevices: input.maxDevices };
    }),
    batchGenerate: protectedProcedure.input(
      z2.object({
        sensorTypes: z2.union([z2.string(), z2.array(z2.string())]),
        days: z2.number().min(1).max(36500),
        category: z2.enum(["production", "rental"]),
        count: z2.number().min(1).max(500),
        maxDevices: z2.number().min(0).max(9999).default(1),
        customerId: z2.number().optional(),
        customerName: z2.string().optional(),
        remark: z2.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const batchId = nanoid(12);
      const keys = [];
      const records = [];
      const sensorTypeStr = Array.isArray(input.sensorTypes) ? input.sensorTypes.join(",") : input.sensorTypes;
      let customerName = input.customerName || null;
      if (input.customerId && !customerName) {
        const customer = await getCustomerById(input.customerId);
        customerName = customer?.name || null;
      }
      for (let i = 0; i < input.count; i++) {
        const keyString = generateLicenseKey(input.sensorTypes, input.days, input.category);
        const expireTimestamp = Date.now() + input.days * 24 * 60 * 60 * 1e3;
        keys.push({ keyString, expireTimestamp });
        records.push({
          keyString,
          sensorType: sensorTypeStr,
          category: input.category,
          days: input.days,
          expireTimestamp,
          maxDevices: input.maxDevices,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || "\u672A\u77E5",
          customerId: input.customerId || null,
          customerName,
          batchId,
          remark: input.remark || null
        });
      }
      await insertLicenseKeys(records);
      return { batchId, keys, count: keys.length };
    }),
    list: protectedProcedure.input(
      z2.object({
        page: z2.number().min(1).default(1),
        pageSize: z2.number().min(1).max(100).default(20),
        category: z2.string().optional(),
        sensorType: z2.string().optional(),
        isActivated: z2.boolean().optional(),
        search: z2.string().optional(),
        customerId: z2.number().optional()
      })
    ).query(async ({ ctx, input }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getLicenseKeys({
        userIds,
        page: input.page,
        pageSize: input.pageSize,
        category: input.category,
        sensorType: input.sensorType,
        isActivated: input.isActivated,
        search: input.search,
        customerId: input.customerId
      });
    }),
    verify: publicProcedure.input(z2.object({
      keyString: z2.string().min(1),
      deviceCode: z2.string().optional()
    })).mutation(async ({ input }) => {
      const decoded = decodeLicenseKey(input.keyString);
      const dbRecord = await getLicenseKeyByString(input.keyString.trim());
      let devices = [];
      let deviceCount = 0;
      let deviceBound = false;
      if (dbRecord) {
        devices = await getKeyDevices(dbRecord.id);
        deviceCount = devices.length;
        if (input.deviceCode) {
          deviceBound = devices.some((d) => d.deviceCode === input.deviceCode.trim());
        }
      }
      return {
        ...decoded,
        isActivated: dbRecord?.isActivated ?? false,
        activatedAt: dbRecord?.activatedAt ?? null,
        createdByName: dbRecord?.createdByName ?? null,
        customerName: dbRecord?.customerName ?? null,
        customerId: dbRecord?.customerId ?? null,
        createdAt: dbRecord?.createdAt ?? null,
        category: dbRecord?.category ?? decoded.category,
        dbRemark: dbRecord?.remark ?? null,
        maxDevices: dbRecord?.maxDevices ?? 1,
        deviceCount,
        devices,
        deviceBound
      };
    }),
    /** 客户端统一接口：激活绑定 + 验证 + 返回授权信息 */
    activate: publicProcedure.input(
      z2.object({
        keyString: z2.string().min(1),
        deviceCode: z2.string().min(1, "\u8BBE\u5907\u7801\u4E0D\u80FD\u4E3A\u7A7A"),
        deviceName: z2.string().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const decoded = decodeLicenseKey(input.keyString);
      if (!decoded.valid) {
        return {
          success: false,
          error: decoded.error || "\u5BC6\u94A5\u65E0\u6548\u6216\u5DF2\u8FC7\u671F",
          // 仍然返回部分信息方便客户端展示
          sensorType: decoded.sensorType || null,
          sensorTypes: decoded.sensorTypes || [],
          isAllTypes: decoded.isAllTypes || false,
          expireDate: decoded.expireDate || null,
          remainingDays: decoded.remainingDays || 0,
          category: decoded.category || null
        };
      }
      const clientIp = ctx.req?.headers?.["x-forwarded-for"] || ctx.req?.socket?.remoteAddress || void 0;
      const activateResult = await activateLicenseKey(input.keyString.trim(), input.deviceCode, input.deviceName, clientIp);
      return {
        ...activateResult,
        // 授权信息
        sensorType: decoded.sensorType || null,
        sensorTypes: decoded.sensorTypes || [],
        isAllTypes: decoded.isAllTypes || false,
        expireDate: decoded.expireDate || null,
        expireTimestamp: decoded.expireTimestamp || null,
        remainingDays: decoded.remainingDays || 0,
        category: decoded.category || null
      };
    }),
    /** 获取密钥的已绑定设备列表 */
    devices: protectedProcedure.input(z2.object({ keyId: z2.number() })).query(async ({ input }) => {
      return getKeyDevices(input.keyId);
    }),
    /** 解绑设备（管理员操作） */
    unbindDevice: adminProcedure.input(z2.object({
      keyId: z2.number(),
      deviceId: z2.number()
    })).mutation(async ({ input }) => {
      return unbindKeyDevice(input.keyId, input.deviceId);
    }),
    // verifyOnDevice 已合并到 activate 接口中
    stats: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getKeyStats(userIds);
    }),
    /** 超级管理员更改密钥类型 */
    changeCategory: superAdminProcedure.input(
      z2.object({
        keyId: z2.number(),
        category: z2.enum(["production", "rental"])
      })
    ).mutation(async ({ input }) => {
      const key = await getLicenseKeyById(input.keyId);
      if (!key) {
        throw new TRPCError3({ code: "NOT_FOUND", message: "\u5BC6\u94A5\u4E0D\u5B58\u5728" });
      }
      if (key.category === input.category) {
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u5BC6\u94A5\u7C7B\u578B\u672A\u53D8\u66F4" });
      }
      const updated = await updateLicenseKeyCategory(input.keyId, input.category);
      return { success: true, key: updated };
    }),
    export: protectedProcedure.input(
      z2.object({
        format: z2.enum(["csv", "json"]),
        category: z2.string().optional(),
        sensorType: z2.string().optional(),
        isActivated: z2.boolean().optional(),
        customerId: z2.number().optional()
      })
    ).mutation(async ({ ctx, input }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      const { items } = await getLicenseKeys({
        userIds,
        page: 1,
        pageSize: 1e4,
        category: input.category,
        sensorType: input.sensorType,
        isActivated: input.isActivated,
        customerId: input.customerId
      });
      const groups = await getSensorTypesGrouped();
      const sensorMap = {};
      for (const g of groups) {
        for (const item of g.items) {
          sensorMap[item.value] = item.label;
        }
      }
      if (input.format === "json") {
        return items.map((k) => ({
          \u5BC6\u94A5: k.keyString,
          \u4F20\u611F\u5668\u7C7B\u578B: k.sensorType.split(",").map((v) => sensorMap[v] || v).join(", "),
          \u5BC6\u94A5\u7C7B\u578B: k.category === "production" ? "\u91CF\u4EA7\u5BC6\u94A5" : "\u5728\u7EBF\u79DF\u8D41\u5BC6\u94A5",
          \u6709\u6548\u671F\u5929\u6570: k.days,
          \u5230\u671F\u65F6\u95F4: new Date(k.expireTimestamp).toLocaleString("zh-CN"),
          \u662F\u5426\u5DF2\u6FC0\u6D3B: k.isActivated ? "\u662F" : "\u5426",
          \u6FC0\u6D3B\u65F6\u95F4: k.activatedAt ? new Date(k.activatedAt).toLocaleString("zh-CN") : "",
          \u5BA2\u6237: k.customerName || "",
          \u521B\u5EFA\u8005: k.createdByName || "",
          \u521B\u5EFA\u65F6\u95F4: k.createdAt.toLocaleString("zh-CN"),
          \u5907\u6CE8: k.remark || ""
        }));
      }
      const header = "\u5BC6\u94A5,\u4F20\u611F\u5668\u7C7B\u578B,\u5BC6\u94A5\u7C7B\u578B,\u6709\u6548\u671F\u5929\u6570,\u5230\u671F\u65F6\u95F4,\u662F\u5426\u5DF2\u6FC0\u6D3B,\u6FC0\u6D3B\u65F6\u95F4,\u5BA2\u6237,\u521B\u5EFA\u8005,\u521B\u5EFA\u65F6\u95F4,\u5907\u6CE8";
      const rows = items.map(
        (k) => [
          k.keyString,
          k.sensorType.split(",").map((v) => sensorMap[v] || v).join("/"),
          k.category === "production" ? "\u91CF\u4EA7\u5BC6\u94A5" : "\u5728\u7EBF\u79DF\u8D41\u5BC6\u94A5",
          k.days,
          new Date(k.expireTimestamp).toLocaleString("zh-CN"),
          k.isActivated ? "\u662F" : "\u5426",
          k.activatedAt ? new Date(k.activatedAt).toLocaleString("zh-CN") : "",
          k.customerName || "",
          k.createdByName || "",
          k.createdAt.toLocaleString("zh-CN"),
          k.remark || ""
        ].join(",")
      );
      return header + "\n" + rows.join("\n");
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs from "fs";
import { nanoid as nanoid2 } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss(), jsxLocPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist", "public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid2()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  try {
    await ensureDefaultSuperAdmin();
    await ensureDefaultSensorTypes();
    await ensureRsaKeyPair();
    console.log("[Init] Database initialization complete");
  } catch (error) {
    console.warn("[Init] Database initialization failed (will retry on first request):", error);
  }
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
