import { bigint, int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Device limits are separate from existing keys so old and new licenses default to unlimited. */
export const licenseDevicePolicies = mysqlTable("license_device_policies", {
  id: int("id").autoincrement().primaryKey(),
  keyType: varchar("key_type", { length: 16 }).notNull(),
  keyId: int("key_id").notNull(),
  maxDevices: int("max_devices").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({ identity: uniqueIndex("license_device_policy_identity").on(table.keyType, table.keyId) }));

/** Revoked registrations remain visible and cannot automatically reclaim a released slot. */
export const licenseDevices = mysqlTable("license_devices", {
  id: int("id").autoincrement().primaryKey(),
  keyType: varchar("key_type", { length: 16 }).notNull(),
  keyId: int("key_id").notNull(),
  deviceId: varchar("device_id", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).default("active").notNull(),
  firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull(),
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
}, table => ({ identity: uniqueIndex("license_device_identity").on(table.keyType, table.keyId, table.deviceId) }));
