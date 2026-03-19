import {
  bigint,
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * 用户表 - 三级权限体系
 * super_admin: 超级管理员（创建管理员）
 * admin: 管理员（创建子账号）
 * user: 子账号（普通用户）
 */
export const users = mysqlTable("users", {
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
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 客户表
 * 记录所有客户信息，密钥生成时可关联客户
 */
export const customers = mysqlTable("customers", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

/**
 * 密钥表
 * 记录所有生成的密钥，包含类型、状态、激活信息、关联客户
 */
export const licenseKeys = mysqlTable("licenseKeys", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LicenseKey = typeof licenseKeys.$inferSelect;
export type InsertLicenseKey = typeof licenseKeys.$inferInsert;

/**
 * 密钥-设备绑定表
 * 记录每个密钥绑定的设备信息（客户自助激活时写入）
 */
export const keyDevices = mysqlTable("keyDevices", {
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
  boundIp: varchar("boundIp", { length: 64 }),
});

export type KeyDevice = typeof keyDevices.$inferSelect;
export type InsertKeyDevice = typeof keyDevices.$inferInsert;

/**
 * 传感器类型表
 * 支持分组管理，超级管理员可动态增删
 */
export const sensorTypes = mysqlTable("sensorTypes", {
  id: int("id").autoincrement().primaryKey(),
  /** 显示名称（如"触觉手套"） */
  label: varchar("label", { length: 128 }).notNull(),
  /** 唯一标识符（如"hand0205"），用于加密和存储 */
  value: varchar("value", { length: 128 }).notNull().unique(),
  /** 所属分组名称（如"触觉手套"、"汽车座椅"） */
  groupName: varchar("groupName", { length: 128 }).notNull(),
  /** 分组图标（emoji） */
  groupIcon: varchar("groupIcon", { length: 16 }).default("📦").notNull(),
  /** 排序顺序（同组内排序） */
  sortOrder: int("sortOrder").default(0).notNull(),
  /** 是否启用 */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SensorType = typeof sensorTypes.$inferSelect;
export type InsertSensorType = typeof sensorTypes.$inferInsert;

/**
 * RSA 密钥对表
 * 存储用于离线密钥签名的 RSA 密钥对
 */
export const rsaKeyPairs = mysqlTable("rsaKeyPairs", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RsaKeyPair = typeof rsaKeyPairs.$inferSelect;
export type InsertRsaKeyPair = typeof rsaKeyPairs.$inferInsert;

/**
 * 离线密钥表
 * 记录所有生成的离线激活码（RSA 签名）
 */
export const offlineKeys = mysqlTable("offlineKeys", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OfflineKey = typeof offlineKeys.$inferSelect;
export type InsertOfflineKey = typeof offlineKeys.$inferInsert;
