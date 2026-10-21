import { bigint, boolean, index, int, mysqlTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Durable upload identities serialize deletion with ingestion and block old queued content. */
export const uploadDataGuards = mysqlTable("upload_data_guards", {
  kind: varchar("kind", { length: 16 }).notNull(), sourceId: int("source_id").notNull(),
  installationId: varchar("installation_id", { length: 36 }).notNull(), objectId: varchar("object_id", { length: 160 }).notNull(),
  blocked: boolean("blocked").notNull().default(false), payloadHash: varchar("payload_hash", { length: 64 }),
  deletedAt: timestamp("deleted_at"),
}, table => [primaryKey({ columns: [table.kind, table.sourceId, table.installationId, table.objectId] })]);

/** Append-only content-free receipt of administrator and scheduled retention work. */
export const uploadDeletionAudit = mysqlTable("upload_deletion_audit", {
  id: int("id").autoincrement().primaryKey(), actorId: int("actor_id"),
  action: varchar("action", { length: 32 }).notNull(), kind: varchar("kind", { length: 16 }).notNull(),
  affected: int("affected").notNull(), scopeJson: text("scope_json").notNull(),
  cutoffMs: bigint("cutoff_ms", { mode: "number" }), createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [index("upload_deletion_audit_created").on(table.createdAt)]);
