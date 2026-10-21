import { bigint, index, int, longtext, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** 商品身份独立于版本；首个提交者取得归属，并发新版本锁定同一身份行。 */
export const algorithmProducts = mysqlTable("algorithm_products", {
  id: varchar("id", { length: 80 }).primaryKey(), ownerId: int("owner_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 商品执行版本不可覆盖；公开目录只使用审查通过的声明信息。 */
export const algorithmProductVersions = mysqlTable("algorithm_product_versions", {
  id: int("id").autoincrement().primaryKey(),
  productId: varchar("product_id", { length: 80 }).notNull(),
  version: varchar("version", { length: 48 }).notNull(),
  productJson: longtext("product_json").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  submittedById: int("submitted_by_id").notNull(),
  reviewedById: int("reviewed_by_id"),
  status: mysqlEnum("status", ["pending", "published", "rejected"]).notNull().default("pending"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
}, table => [uniqueIndex("algorithm_product_version_unique").on(table.productId, table.version),
  index("algorithm_product_status").on(table.status, table.id)]);

/** 以稳定客户身份记录申请；重复网络请求不能生成第二份报价需求。 */
export const algorithmPurchaseRequests = mysqlTable("algorithm_purchase_requests", {
  id: int("id").autoincrement().primaryKey(), customerId: int("customer_id").notNull(),
  versionId: int("version_id").notNull(), productId: varchar("product_id", { length: 80 }).notNull(),
  kind: mysqlEnum("kind", ["quote", "trial", "custom"]).notNull(), goal: text("goal").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 80 }).notNull(), contentHash: varchar("content_hash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["requested", "reviewing", "quoted", "cancelled"]).notNull().default("requested"),
  note: text("note"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [uniqueIndex("algorithm_request_retry").on(table.customerId, table.idempotencyKey),
  index("algorithm_request_customer").on(table.customerId, table.id)]);

/** 付款和交付分别留痕；金额按最小货币单位保存，不自动推导算法已安装。 */
export const algorithmManualOrders = mysqlTable("algorithm_manual_orders", {
  id: int("id").autoincrement().primaryKey(), requestId: int("request_id").notNull().unique(),
  customerId: int("customer_id").notNull(), versionId: int("version_id").notNull(),
  productId: varchar("product_id", { length: 80 }).notNull(), amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(), deviceLimit: int("device_limit").notNull(),
  expiresAt: timestamp("expires_at"), terms: text("terms").notNull(),
  status: mysqlEnum("status", ["quoted", "payment_confirmed", "delivered", "cancelled"]).notNull().default("quoted"),
  createdById: int("created_by_id").notNull(), paidById: int("paid_by_id"), deliveredById: int("delivered_by_id"),
  receiptReference: text("receipt_reference"), deliveryReference: text("delivery_reference"),
  paidAt: timestamp("paid_at"), deliveredAt: timestamp("delivered_at"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [index("algorithm_order_customer").on(table.customerId, table.id)]);

/** 审核、报价、收款、交付状态仅追加事件，原始金额与版本不回写。 */
export const algorithmPlatformEvents = mysqlTable("algorithm_platform_events", {
  id: int("id").autoincrement().primaryKey(), entity: varchar("entity", { length: 24 }).notNull(), entityId: int("entity_id").notNull(),
  actorId: int("actor_id"), customerId: int("customer_id"), action: varchar("action", { length: 40 }).notNull(),
  detailsJson: text("details_json").notNull(), createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [index("algorithm_platform_event_entity").on(table.entity, table.entityId, table.id)]);
