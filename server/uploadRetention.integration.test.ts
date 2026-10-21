import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentSyncEventSchema } from "./agentSyncSchema";
import { usageEventSchema } from "./usageSchema";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ getDb: async () => testDb }));
import { persistAgentEvent } from "./agentSyncStore";
import { persistUsageBatch } from "./usageStore";
import { cleanupExpiredUploads, deleteUploadedIdentity } from "./uploadRetention";

const adminUrl = process.env.UPLOAD_RETENTION_TEST_ADMIN_URL;
describe.skipIf(!adminUrl)("upload retention MySQL atomic deletion and replay", () => {
  let admin: Connection, pool: Pool;
  const name = `upload_retention_test_${randomUUID().replaceAll("-", "")}`;
  const installationId = randomUUID();
  /** Query only this test's random local database. */
  async function rows(query: string, args: unknown[] = []) { return (await pool.query<RowDataPacket[]>(query, args))[0]; }
  /** Construct a synthetic labelled chat snapshot. */
  function chat(id: string, revision = 1) {
    return agentSyncEventSchema.parse({ schemaVersion: 1, eventType: "agent.conversation.upsert", eventId: randomUUID(),
      installationId, conversationId: id, revision, occurredAt: new Date().toISOString(),
      conversation: { id, messages: [{ id: "m1", role: "user", text: "synthetic" }], tasks: [], attachments: [] } });
  }
  /** Construct a synthetic usage event with no client or sensor data. */
  function usage() {
    return usageEventSchema.parse({ schemaVersion: 1, eventId: randomUUID(), installationId, sessionId: randomUUID(),
      occurredAt: new Date().toISOString(), appVersion: "test", environment: "test", eventName: "feature_exposed", properties: {} });
  }
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    url.pathname = `/${name}`; pool = mysql.createPool({ uri: url.toString(), connectionLimit: 8 }); testDb = drizzle(pool);
    for (const file of ["0013_agent_chat_sync.sql", "0015_usage_analytics.sql", "0022_upload_retention.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
    }
  });
  afterAll(async () => {
    await pool?.end(); if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${name}\``); await admin.end(); }
  });
  it("previews without writes, removes old content, and acknowledges old chat queues without resurrection", async () => {
    const old = chat("expired"); await persistAgentEvent(11, old);
    await pool.query("UPDATE agent_conversations SET received_at=DATE_SUB(NOW(), INTERVAL 181 DAY) WHERE conversation_id='expired'");
    const preview = await cleanupExpiredUploads({ now: Date.now() });
    expect(preview).toMatchObject({ dryRun: true, chat: 1 });
    expect(await rows("SELECT * FROM upload_deletion_audit")).toHaveLength(0);
    expect(await rows("SELECT * FROM agent_conversations")).toHaveLength(1);
    expect(await cleanupExpiredUploads({ dryRun: false, actorId: 7 })).toMatchObject({ chat: 1 });
    await persistAgentEvent(11, old); await persistAgentEvent(11, chat("expired", 900));
    expect(await rows("SELECT * FROM agent_conversations WHERE conversation_id='expired'")).toHaveLength(0);
    expect((await rows("SELECT * FROM upload_data_guards WHERE kind='chat'"))[0].blocked).toBe(1);
    await persistAgentEvent(11, chat("new-conversation"));
    expect(await rows("SELECT * FROM agent_conversations WHERE conversation_id='new-conversation'")).toHaveLength(1);
  });
  it("keeps usage tombstones and immutable hashes after ninety days", async () => {
    const event = usage(); const principal = { sourceId: 12, customerId: null, customerName: "synthetic" };
    await persistUsageBatch(principal, [event]);
    await pool.query("UPDATE usage_events SET received_at=DATE_SUB(NOW(), INTERVAL 91 DAY) WHERE event_id=?", [event.eventId]);
    expect(await cleanupExpiredUploads({ dryRun: false })).toMatchObject({ usage: 1 });
    await persistUsageBatch(principal, [event]);
    expect(await rows("SELECT * FROM usage_events WHERE event_id=?", [event.eventId])).toHaveLength(0);
    await expect(persistUsageBatch(principal, [{ ...event, appVersion: "changed" }])).rejects.toMatchObject({ status: 409 });
    await persistUsageBatch(principal, [usage()]);
    expect(await rows("SELECT * FROM usage_events WHERE source_id=12")).toHaveLength(1);
  });
  it("scopes manual deletion to a single source and records the administrator atomically", async () => {
    const a = chat("shared-id"); await persistAgentEvent(21, a); await persistAgentEvent(22, a);
    const key = { kind: "chat" as const, sourceId: 21, installationId, objectId: "shared-id" };
    expect(await deleteUploadedIdentity(key, 7)).toMatchObject({ deleted: 1 });
    expect(await deleteUploadedIdentity(key, 7)).toMatchObject({ deleted: 0 });
    await persistAgentEvent(21, chat("shared-id", 3));
    const remaining = await rows("SELECT * FROM agent_conversations WHERE conversation_id='shared-id'");
    expect(remaining).toHaveLength(1); expect(remaining[0].tenant_id).toBe(22);
    const audit = await rows("SELECT * FROM upload_deletion_audit WHERE action='manual-delete' ORDER BY id");
    expect(audit[0]).toMatchObject({ actor_id: 7, affected: 1 });
    expect(JSON.stringify(audit)).not.toContain("synthetic");
  });
  it("bounds cleanup and preserves recently updated snapshots", async () => {
    for (const id of ["old-a", "old-b", "fresh"]) await persistAgentEvent(31, chat(id));
    await pool.query("UPDATE agent_conversations SET received_at=DATE_SUB(NOW(), INTERVAL 181 DAY) WHERE conversation_id IN ('old-a','old-b')");
    expect(await cleanupExpiredUploads({ dryRun: false, limit: 1 })).toMatchObject({ chat: 1, hasMore: true, limit: 1 });
    expect(await rows("SELECT * FROM agent_conversations WHERE conversation_id='fresh'")).toHaveLength(1);
  });
});
