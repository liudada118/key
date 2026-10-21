import { and, asc, eq, lt, sql } from "drizzle-orm";
import { agentConversations, usageEvents } from "../drizzle/schema";
import { uploadDataGuards, uploadDeletionAudit } from "../drizzle/uploadRetentionSchema";
import { getDb } from "./db";

export type UploadKind = "chat" | "usage";
export type UploadIdentity = { kind: UploadKind; sourceId: number; installationId: string; objectId: string };
type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const DAY = 86400000;
export const UPLOAD_RETENTION = Object.freeze({ policyVersion: 1, chatDays: 180, usageDays: 90, maxBatch: 500 });

/** Expose only public policy facts; no credentials, database addresses or filesystem paths. */
export function uploadRetentionPolicy() {
  return { ...UPLOAD_RETENTION, enabled: process.env.SHROOM_DATA_RETENTION_ENABLED === "1",
    intervalMinutes: 60, clock: "server-received-at", deletedConversationPolicy: "permanent-id-tombstone" };
}

/** Require an explicit database rather than silently accepting an unpersisted deletion. */
async function database() {
  const db = await getDb();
  if (!db) throw new Error("STORAGE_UNAVAILABLE");
  return db;
}

/** Produce the full tenant/install/object identity; names and customer mappings never substitute for keys. */
function guardWhere(key: UploadIdentity) {
  return and(eq(uploadDataGuards.kind, key.kind), eq(uploadDataGuards.sourceId, key.sourceId),
    eq(uploadDataGuards.installationId, key.installationId.toLowerCase()), eq(uploadDataGuards.objectId, key.objectId));
}

/** Lock one durable identity before touching content so ingestion cannot race with deletion. */
export async function lockUploadGuard(tx: Transaction, key: UploadIdentity) {
  await tx.insert(uploadDataGuards).values({ ...key, installationId: key.installationId.toLowerCase() })
    .onDuplicateKeyUpdate({ set: { objectId: sql`object_id` } });
  const [guard] = await tx.select().from(uploadDataGuards).where(guardWhere(key)).for("update");
  return guard;
}

/** Prevent changed event content from reusing an immutable usage identity, including after content deletion. */
export async function registerUsageGuard(tx: Transaction, key: UploadIdentity, payloadHash: string) {
  const guard = await lockUploadGuard(tx, key);
  if (guard.payloadHash && guard.payloadHash !== payloadHash) return { conflict: true, blocked: guard.blocked };
  if (!guard.payloadHash) await tx.update(uploadDataGuards).set({ payloadHash }).where(guardWhere(key));
  return { conflict: false, blocked: guard.blocked };
}

/** Select a bounded set of inactive uploads; latest accepted snapshot time governs chat retention. */
async function expiredKeys(db: Database, kind: UploadKind, cutoff: Date, limit: number) {
  return kind === "chat"
    ? db.select({ sourceId: agentConversations.tenantId, installationId: agentConversations.installationId,
      objectId: agentConversations.conversationId }).from(agentConversations).where(lt(agentConversations.receivedAt, cutoff))
      .orderBy(asc(agentConversations.receivedAt)).limit(limit)
    : db.select({ sourceId: usageEvents.sourceId, installationId: usageEvents.installationId, objectId: usageEvents.eventId })
      .from(usageEvents).where(lt(usageEvents.receivedAt, cutoff)).orderBy(asc(usageEvents.receivedAt)).limit(limit);
}

/** Remove content under its guard lock, retaining a permanent minimal tombstone and content-free audit. */
async function deleteIdentity(tx: Transaction, key: UploadIdentity, cutoff?: Date) {
  await lockUploadGuard(tx, key);
  const chat = key.kind === "chat";
  const table = chat ? agentConversations : usageEvents;
  const identity = chat ? and(eq(agentConversations.tenantId, key.sourceId), eq(agentConversations.installationId, key.installationId),
    eq(agentConversations.conversationId, key.objectId)) : and(eq(usageEvents.sourceId, key.sourceId),
    eq(usageEvents.installationId, key.installationId), eq(usageEvents.eventId, key.objectId));
  const condition = cutoff ? and(identity, lt(table.receivedAt, cutoff)) : identity;
  const rows = chat
    ? await tx.select({ receivedAt: agentConversations.receivedAt }).from(agentConversations).where(condition).for("update")
    : await tx.select({ payloadHash: usageEvents.payloadHash }).from(usageEvents).where(condition).for("update");
  if (!rows.length) return 0;
  const payloadHash = chat ? undefined : (rows[0] as { payloadHash: string }).payloadHash;
  await tx.update(uploadDataGuards).set({ blocked: true, deletedAt: new Date(), ...(payloadHash ? { payloadHash } : {}) }).where(guardWhere(key));
  await tx.delete(table).where(condition);
  return 1;
}

/** Preview or execute at most one bounded batch per kind; each destructive batch is atomic and audited. */
export async function cleanupExpiredUploads(input: { dryRun?: boolean; limit?: number; actorId?: number; now?: number } = {}, connection?: Database) {
  const db = connection ?? await database();
  const now = input.now ?? Date.now();
  const limit = Math.max(1, Math.min(UPLOAD_RETENTION.maxBatch, Math.trunc(input.limit ?? 100)));
  const dryRun = input.dryRun !== false;
  const result = { dryRun, chat: 0, usage: 0, limit, hasMore: false };
  for (const kind of ["chat", "usage"] as const) {
    const cutoff = new Date(now - (kind === "chat" ? UPLOAD_RETENTION.chatDays : UPLOAD_RETENTION.usageDays) * DAY);
    const keys = await expiredKeys(db, kind, cutoff, limit);
    result.hasMore ||= keys.length === limit;
    if (dryRun) { result[kind] = keys.length; continue; }
    result[kind] = await db.transaction(async tx => {
      let affected = 0;
      // Shared lock ordering avoids deadlocks with batch upload and other cleaners.
      keys.sort((a, b) => `${a.sourceId}:${a.installationId}:${a.objectId}`.localeCompare(`${b.sourceId}:${b.installationId}:${b.objectId}`));
      for (const key of keys) affected += await deleteIdentity(tx, { ...key, kind }, cutoff);
      await tx.insert(uploadDeletionAudit).values({ actorId: input.actorId ?? null, action: "retention-cleanup", kind,
        affected, scopeJson: JSON.stringify({ limit, policyVersion: UPLOAD_RETENTION.policyVersion }), cutoffMs: cutoff.getTime() });
      return affected;
    });
  }
  return result;
}

/** Explicit administrator deletion affects only the specified uploaded identity, never local customer files. */
export async function deleteUploadedIdentity(key: UploadIdentity, actorId: number, connection?: Database) {
  const db = connection ?? await database();
  const identity = { kind: key.kind, sourceId: key.sourceId, installationId: key.installationId.toLowerCase(),
    objectId: key.kind === "usage" ? key.objectId.toLowerCase() : key.objectId };
  return db.transaction(async tx => {
    const affected = await deleteIdentity(tx, identity);
    await tx.insert(uploadDeletionAudit).values({ actorId, action: "manual-delete", kind: key.kind, affected,
      scopeJson: JSON.stringify(identity) });
    return { deleted: affected, localDataUnaffected: true };
  });
}

/** Read bounded administrator audit metadata without returning any deleted content. */
export async function listUploadDeletionAudit() {
  const db = await database();
  return db.select().from(uploadDeletionAudit).orderBy(sql`${uploadDeletionAudit.id} DESC`).limit(100);
}

/** Start a single non-overlapping hourly worker only after explicit operator opt-in. */
export function startUploadRetentionWorker(run = cleanupExpiredUploads) {
  if (process.env.SHROOM_DATA_RETENTION_ENABLED !== "1") return () => {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await run({ dryRun: false, limit: UPLOAD_RETENTION.maxBatch }); }
    catch { console.error("[UploadRetention] CLEANUP_FAILED"); }
    finally { running = false; }
  }, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
