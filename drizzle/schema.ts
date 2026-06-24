import {
  bigint,
  boolean,
  date,
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
  /** 所属团队 ID */
  teamId: int("teamId"),
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
 * 团队表
 * 支持多级团队结构，用于数据域权限隔离
 */
export const teams = mysqlTable("teams", {
  id: int("id").autoincrement().primaryKey(),
  /** 团队名称 */
  name: varchar("name", { length: 128 }).notNull(),
  /** 团队描述 */
  description: text("description"),
  /** 团队负责人 ID */
  leaderId: int("leaderId"),
  /** 负责人名称 */
  leaderName: varchar("leaderName", { length: 128 }),
  /** 上级团队 ID（支持多级） */
  parentTeamId: int("parentTeamId"),
  /** 是否启用 */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

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
 * 合同表
 * 管理客户合同，密钥生成需关联合同
 */
export const contracts = mysqlTable("contracts", {
  id: int("id").autoincrement().primaryKey(),
  /** 合同编号（唯一） */
  contractNo: varchar("contractNo", { length: 128 }).notNull().unique(),
  /** 合同标题 */
  title: varchar("title", { length: 256 }).notNull(),
  /** 关联客户 ID */
  customerId: int("customerId"),
  /** 客户名称（冗余） */
  customerName: varchar("customerName", { length: 256 }),
  /** 签订日期 */
  signDate: date("signDate"),
  /** 生效日期 */
  startDate: date("startDate"),
  /** 结束日期 */
  endDate: date("endDate"),
  /** 合同约定密钥总数 */
  totalKeys: int("totalKeys").default(0).notNull(),
  /** 已使用密钥数 */
  usedKeys: int("usedKeys").default(0).notNull(),
  /** 合同状态 */
  status: mysqlEnum("status", ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).default("DRAFT").notNull(),
  /** 备注 */
  remark: text("remark"),
  /** 创建者 ID */
  createdById: int("createdById").notNull(),
  /** 创建者名称 */
  createdByName: varchar("createdByName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Contract = typeof contracts.$inferSelect;
export type InsertContract = typeof contracts.$inferInsert;

/**
 * 密钥生命周期状态枚举
 * ISSUED: 已签发（生成后未激活）
 * ACTIVATED: 已激活（至少绑定了一台设备）
 * SUSPENDED: 已暂停（管理员手动暂停）
 * EXPIRED: 已过期（超过有效期）
 * RENEWED: 已续期（从过期状态续期）
 * REVOKED: 已吊销（永久作废）
 * TAMPERED: 异常（服务端检测到客户端时间回拨 / 客户端上报篡改）
 */
export const KEY_STATUS = ["ISSUED", "ACTIVATED", "SUSPENDED", "EXPIRED", "RENEWED", "REVOKED", "TAMPERED"] as const;
export type KeyStatus = typeof KEY_STATUS[number];

/**
 * 密钥表
 * 记录所有生成的密钥，包含类型、状态、激活信息、关联客户
 */
export const licenseKeys = mysqlTable("licenseKeys", {
  id: int("id").autoincrement().primaryKey(),
  /** 加密后的密钥字符串 (hex) */
  keyString: text("keyString").notNull(),
  /** 密钥哈希（SHA-256），用于激活时比对 */
  keyHash: varchar("keyHash", { length: 64 }),
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
  /** 关联合同 ID */
  contractId: int("contractId"),
  /** 合同编号（冗余） */
  contractNo: varchar("contractNo", { length: 128 }),
  /** 客户名称（冗余存储，方便查询） */
  customerName: varchar("customerName", { length: 256 }),
  /** 最大可绑定设备数量（0 表示不限制） */
  maxDevices: int("maxDevices").default(1).notNull(),
  /** 是否已激活（至少绑定了一台设备）— 兼容旧逻辑 */
  isActivated: boolean("isActivated").default(false).notNull(),
  /** 密钥生命周期状态 */
  status: mysqlEnum("status", ["ISSUED", "ACTIVATED", "SUSPENDED", "EXPIRED", "RENEWED", "REVOKED", "TAMPERED"]).default("ISSUED").notNull(),
  /** 首次激活时间 */
  activatedAt: timestamp("activatedAt"),
  /** 激活设备信息（兼容旧字段，新流程使用 keyDevices 表） */
  activatedDevice: text("activatedDevice"),
  /** 暂停时间 */
  suspendedAt: timestamp("suspendedAt"),
  /** 暂停/吊销原因 */
  suspendReason: text("suspendReason"),
  /** 吊销时间 */
  revokedAt: timestamp("revokedAt"),
  /** 吊销原因 */
  revokeReason: text("revokeReason"),
  /** 续期时间 */
  renewedAt: timestamp("renewedAt"),
  /** 续期前的到期时间戳（用于记录历史） */
  previousExpireTimestamp: bigint("previousExpireTimestamp", { mode: "number" }),
  // ===== 防回拨：服务端权威时间高水位 & 异常元数据 =====
  /** 该 key 历次上报 clientTime 的最大值（可信时间高水位，ms） */
  lastSeenClientTime: bigint("lastSeenClientTime", { mode: "number" }),
  /** 最近一次 /licenseCheck 的服务器时间 */
  lastCheckAt: timestamp("lastCheckAt"),
  /** 被标记为异常(TAMPERED)的时间 */
  tamperedAt: timestamp("tamperedAt"),
  /** 异常触发原因（client上报 / 服务端检测回拨） */
  tamperReason: text("tamperReason"),
  /** 触发异常时客户端上报的本机时间 (ms) */
  reportedClientTime: bigint("reportedClientTime", { mode: "number" }),
  /** 触发异常时的服务器时间 (ms) */
  tamperServerTime: bigint("tamperServerTime", { mode: "number" }),
  /** 被标记异常前的状态（清除异常时恢复用） */
  statusBeforeTamper: mysqlEnum("statusBeforeTamper", ["ISSUED", "ACTIVATED", "SUSPENDED", "EXPIRED", "RENEWED", "REVOKED", "TAMPERED"]),
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
 * 设备心跳表
 * 记录在线密钥绑定设备的心跳信息，用于持续校验
 */
export const deviceHeartbeats = mysqlTable("deviceHeartbeats", {
  id: int("id").autoincrement().primaryKey(),
  /** 关联的密钥 ID */
  keyId: int("keyId").notNull(),
  /** 密钥类型 */
  keyType: mysqlEnum("keyType", ["online", "offline"]).default("online").notNull(),
  /** 设备码 */
  deviceCode: varchar("deviceCode", { length: 256 }).notNull(),
  /** 最后心跳时间 */
  lastHeartbeatAt: timestamp("lastHeartbeatAt").defaultNow().notNull(),
  /** 累计心跳次数 */
  heartbeatCount: int("heartbeatCount").default(1).notNull(),
  /** 客户端 IP */
  clientIp: varchar("clientIp", { length: 64 }),
  /** 客户端版本 */
  clientVersion: varchar("clientVersion", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DeviceHeartbeat = typeof deviceHeartbeats.$inferSelect;
export type InsertDeviceHeartbeat = typeof deviceHeartbeats.$inferInsert;

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
  /** 关联合同 ID */
  contractId: int("contractId"),
  /** 合同编号（冗余） */
  contractNo: varchar("contractNo", { length: 128 }),
  /** 客户名称 */
  customerName: varchar("customerName", { length: 256 }),
  /** 备注 */
  remark: text("remark"),
  /** 密钥生命周期状态 */
  status: mysqlEnum("status", ["ISSUED", "ACTIVATED", "SUSPENDED", "EXPIRED", "RENEWED", "REVOKED", "TAMPERED"]).default("ISSUED").notNull(),
  /** 暂停时间 */
  suspendedAt: timestamp("suspendedAt"),
  /** 暂停原因 */
  suspendReason: text("suspendReason"),
  /** 吊销时间 */
  revokedAt: timestamp("revokedAt"),
  /** 吊销原因 */
  revokeReason: text("revokeReason"),
  /** 许可证版本 */
  licenseVersion: int("licenseVersion").notNull().default(2),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OfflineKey = typeof offlineKeys.$inferSelect;
export type InsertOfflineKey = typeof offlineKeys.$inferInsert;

/**
 * 密钥状态变更历史表
 * 记录每次状态流转（谁、什么时候、从什么状态到什么状态、原因）
 */
export const keyStatusHistory = mysqlTable("keyStatusHistory", {
  id: int("id").autoincrement().primaryKey(),
  /** 密钥类型：online / offline */
  keyType: mysqlEnum("keyType", ["online", "offline"]).notNull(),
  /** 关联的密钥 ID */
  keyId: int("keyId").notNull(),
  /** 变更前状态 */
  fromStatus: mysqlEnum("fromStatus", ["ISSUED", "ACTIVATED", "SUSPENDED", "EXPIRED", "RENEWED", "REVOKED", "TAMPERED"]),
  /** 变更后状态 */
  toStatus: mysqlEnum("toStatus", ["ISSUED", "ACTIVATED", "SUSPENDED", "EXPIRED", "RENEWED", "REVOKED", "TAMPERED"]).notNull(),
  /** 变更原因 */
  reason: text("reason"),
  /** 操作人 ID */
  actorId: int("actorId").notNull(),
  /** 操作人名称 */
  actorName: varchar("actorName", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KeyStatusHistory = typeof keyStatusHistory.$inferSelect;
export type InsertKeyStatusHistory = typeof keyStatusHistory.$inferInsert;

/**
 * 审计日志表
 * 记录所有增删改查及敏感操作（人、时间、IP、操作前后数据）
 */
export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  /** 操作人 ID */
  userId: int("userId").notNull(),
  /** 操作人名称 */
  userName: varchar("userName", { length: 128 }),
  /** 操作类型 */
  action: mysqlEnum("action", [
    "CREATE", "UPDATE", "DELETE", "ACTIVATE",
    "SUSPEND", "REVOKE", "RENEW", "RESTORE",
    "EXPORT", "LOGIN", "LOGOUT", "UNBIND",
  ]).notNull(),
  /** 资源类型 */
  resourceType: varchar("resourceType", { length: 64 }),
  /** 资源 ID */
  resourceId: int("resourceId"),
  /** 操作前数据快照 (JSON) */
  before: text("before"),
  /** 操作后数据快照 (JSON) */
  after: text("after"),
  /** 操作描述 */
  description: text("description"),
  /** 客户端 IP */
  ip: varchar("ip", { length: 64 }),
  /** User Agent */
  userAgent: varchar("userAgent", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
