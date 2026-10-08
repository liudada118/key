import { index, int, longtext, mysqlEnum, mysqlTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Immutable submitted package; publication changes metadata only, never packageJson. */
export const systemPackageSubmissions = mysqlTable("system_package_submissions", {
  id: int("id").autoincrement().primaryKey(),
  systemId: varchar("system_id", { length: 80 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  packageJson: longtext("package_json").notNull(),
  baseVersion: int("base_version"),
  status: mysqlEnum("status", ["pending", "rejected", "published", "revoked"]).default("pending").notNull(),
  submittedById: int("submitted_by_id").notNull(),
  reviewedById: int("reviewed_by_id"),
  reviewNote: text("review_note"),
  audienceJson: text("audience_json"),
  signature: text("signature"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"),
}, table => [index("system_package_lookup").on(table.systemId, table.status, table.id)]);

/** Append-only audit of review, publication, revocation and audience changes. */
export const systemPackageEvents = mysqlTable("system_package_events", {
  id: int("id").autoincrement().primaryKey(),
  submissionId: int("submission_id").notNull(),
  actorId: int("actor_id").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  detailsJson: text("details_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => [index("system_package_event_lookup").on(table.submissionId, table.id)]);

/** Active release pointer per system and customer; customer 0 is the global default. */
export const systemPackageRollouts = mysqlTable("system_package_rollouts", {
  systemId: varchar("system_id", { length: 80 }).notNull(),
  customerId: int("customer_id").notNull(),
  versionId: int("version_id").notNull(),
  updatedById: int("updated_by_id").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => [primaryKey({ columns: [table.systemId, table.customerId] }),
  index("system_package_rollout_version").on(table.versionId)]);

/** Short-lived employee credentials grant submission only, never review or customer download. */
export const systemPackageSubmitTokens = mysqlTable("system_package_submit_tokens", {
  id: int("id").autoincrement().primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  userId: int("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
}, table => [index("system_package_submit_user").on(table.userId)]);
