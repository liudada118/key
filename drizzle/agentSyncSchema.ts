import { bigint, index, int, longtext, mysqlTable, primaryKey, timestamp, varchar } from "drizzle-orm/mysql-core";

export const agentChatSources = mysqlTable("agent_chat_sources", {
  id: int("id").autoincrement().primaryKey(),
  customerId: int("customer_id").unique("agent_source_customer"),
  licenseKeyId: int("license_key_id").unique("agent_source_license"),
});

export const agentUploadCredentials = mysqlTable("agent_upload_credentials", {
  id: int("id").autoincrement().primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique("token_hash"),
  tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
  tenantId: int("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  scope: varchar("scope", { length: 64 }).notNull().default("agent:upload"),
  createdById: int("created_by_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
}, table => [index("agent_credentials_tenant").on(table.tenantId)]);

export const agentConversations = mysqlTable("agent_conversations", {
  tenantId: int("tenant_id").notNull(),
  installationId: varchar("installation_id", { length: 36 }).notNull(),
  conversationId: varchar("conversation_id", { length: 160 }).notNull(),
  revision: bigint("revision", { mode: "number", unsigned: true }).notNull(),
  snapshotJson: longtext("snapshot_json").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.tenantId, table.installationId, table.conversationId] })]);

export const agentSyncEvents = mysqlTable("agent_sync_events", {
  tenantId: int("tenant_id").notNull(),
  installationId: varchar("installation_id", { length: 36 }).notNull(),
  eventId: varchar("event_id", { length: 36 }).notNull(),
  conversationId: varchar("conversation_id", { length: 160 }).notNull(),
  revision: bigint("revision", { mode: "number", unsigned: true }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.tenantId, table.installationId, table.eventId] })]);
