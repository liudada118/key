import { bigint, index, int, mysqlTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const usageSources = mysqlTable("usage_sources", {
  sourceId: int("source_id").primaryKey(), customerId: int("customer_id"),
  customerName: varchar("customer_name", { length: 256 }).notNull(),
  firstReceivedAt: timestamp("first_received_at").defaultNow().notNull(),
}, table => [index("usage_source_customer").on(table.customerId)]);

export const usageEvents = mysqlTable("usage_events", {
  sourceId: int("source_id").notNull(), installationId: varchar("installation_id", { length: 36 }).notNull(),
  eventId: varchar("event_id", { length: 36 }).notNull(), sessionId: varchar("session_id", { length: 36 }).notNull(),
  occurredMs: bigint("occurred_ms", { mode: "number" }).notNull(),
  appVersion: varchar("app_version", { length: 80 }).notNull(),
  environment: varchar("environment", { length: 16 }).notNull(), eventName: varchar("event_name", { length: 40 }).notNull(),
  featureId: varchar("feature_id", { length: 80 }), module: varchar("module", { length: 80 }),
  result: varchar("result", { length: 16 }), durationMs: bigint("duration_ms", { mode: "number" }),
  occurrenceCount: bigint("occurrence_count", { mode: "number" }).notNull(),
  errorFingerprint: varchar("error_fingerprint", { length: 64 }),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(), payloadJson: text("payload_json").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, table => [
  primaryKey({ columns: [table.sourceId, table.installationId, table.eventId] }),
  index("usage_period").on(table.environment, table.occurredMs),
  index("usage_source_period").on(table.sourceId, table.occurredMs),
  index("usage_session").on(table.sourceId, table.installationId, table.sessionId, table.occurredMs),
  index("usage_errors").on(table.eventName, table.occurredMs),
]);
