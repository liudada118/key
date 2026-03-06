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
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
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
 * 密钥表
 * 记录所有生成的密钥，包含类型、状态、激活信息
 */
export const licenseKeys = mysqlTable("licenseKeys", {
  id: int("id").autoincrement().primaryKey(),
  /** 加密后的密钥字符串 (hex) */
  keyString: text("keyString").notNull(),
  /** 传感器类型 */
  sensorType: varchar("sensorType", { length: 32 }).notNull(),
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
  /** 是否已激活 */
  isActivated: boolean("isActivated").default(false).notNull(),
  /** 激活时间 */
  activatedAt: timestamp("activatedAt"),
  /** 激活设备信息（可选） */
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
