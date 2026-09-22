import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Pool, type Connection, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentSyncEventSchema } from "./agentSyncSchema";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ getDb: async () => testDb }));
import { authenticateUpload, getAgentConversation, issueUploadCredential, listAgentChatCustomers, listAgentConversations, listUploadCredentials, persistAgentEvent, revokeUploadCredential } from "./agentSyncStore";

// Explicit opt-in. The fixture creates and drops only its own random database on a local test server.
const adminUrl = process.env.AGENT_SYNC_TEST_ADMIN_URL;
describe.skipIf(!adminUrl)("Agent sync MySQL transactions", () => {
  let admin: Connection;
  let pool: Pool;
  const dbName = `agent_sync_test_${randomUUID().replaceAll("-", "")}`;
  const installationId = randomUUID();
  function event(revision = 1, conversationId = "conversation-test") {
    return agentSyncEventSchema.parse({ schemaVersion: 1, eventType: "agent.conversation.upsert", eventId: randomUUID(),
      installationId, conversationId, revision, occurredAt: "2026-09-22T06:30:00.000Z",
      conversation: { id: conversationId, messages: [{ id: "m1", role: "user", text: `revision-${revision}` }], tasks: [], attachments: [] },
    });
  }
  async function rows(query: string, args: unknown[] = []) { return (await pool.query<RowDataPacket[]>(query, args))[0]; }
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    url.pathname = `/${dbName}`;
    pool = mysql.createPool({ uri: url.toString(), connectionLimit: 8 });
    testDb = drizzle(pool);
    await pool.query("CREATE TABLE customers (id int PRIMARY KEY, isActive boolean NOT NULL, name varchar(256))");
    await pool.query("INSERT INTO customers VALUES (1,1,'Customer A'),(2,1,'Customer B'),(3,0,'Inactive')");
    const migration = await readFile(new URL("../drizzle/0013_agent_chat_sync.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``); await admin.end(); }
  });

  it("stores only credential hashes, binds tenants, and rejects revoked/expired/inactive credentials", async () => {
    const credential = await issueUploadCredential({ tenantId: 1, name: "Fixture", days: 90, createdById: 1 });
    const stored = await rows("SELECT * FROM agent_upload_credentials WHERE id=?", [credential.id]);
    expect(stored[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(credential.token);
    expect(await authenticateUpload(credential.token)).toMatchObject({ tenantId: 1 });
    expect(JSON.stringify(await listUploadCredentials(1))).not.toContain("tokenHash");
    await revokeUploadCredential(credential.id);
    await expect(authenticateUpload(credential.token)).rejects.toMatchObject({ status: 401 });
    const expiring = await issueUploadCredential({ tenantId: 2, name: "Expiry", days: 1, createdById: 1 });
    await pool.query("UPDATE agent_upload_credentials SET expires_at=DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE id=?", [expiring.id]);
    await expect(authenticateUpload(expiring.token)).rejects.toMatchObject({ status: 401 });
    await expect(issueUploadCredential({ tenantId: 3, name: "Inactive", days: 1, createdById: 1 })).rejects.toMatchObject({ status: 400 });
    const active = await issueUploadCredential({ tenantId: 2, name: "Permission", days: 1, createdById: 1 });
    await pool.query("UPDATE agent_upload_credentials SET scope='other' WHERE id=?", [active.id]);
    await expect(authenticateUpload(active.token)).rejects.toMatchObject({ status: 403 });
  });

  it("deduplicates concurrent retries and rejects conflicts without replacing receipts", async () => {
    const payload = event(1, "duplicate");
    await Promise.all(Array.from({ length: 5 }, () => persistAgentEvent(1, payload)));
    expect((await rows("SELECT * FROM agent_sync_events WHERE event_id=?", [payload.eventId])).length).toBe(1);
    const changed = structuredClone(payload);
    changed.conversation.messages[0].text = "conflicting";
    await expect(persistAgentEvent(1, changed)).rejects.toMatchObject({ status: 409 });
    await persistAgentEvent(1, payload);
    expect(JSON.parse((await rows("SELECT snapshot_json FROM agent_conversations WHERE conversation_id='duplicate'"))[0].snapshot_json)).toEqual(payload);
  });

  it("keeps the largest revision under concurrent, late and equal-revision events", async () => {
    const latest = event(10, "ordered");
    await persistAgentEvent(1, latest);
    await Promise.all([1, 3, 5, 8, 10].map(revision => persistAgentEvent(1, event(revision, "ordered"))));
    const saved = (await rows("SELECT * FROM agent_conversations WHERE conversation_id='ordered'"))[0];
    expect(Number(saved.revision)).toBe(10);
    expect(JSON.parse(saved.snapshot_json)).toEqual(latest);
    await Promise.all([12, 11, 15, 14, 13].map(revision => persistAgentEvent(1, event(revision, "ordered"))));
    expect(Number((await rows("SELECT revision FROM agent_conversations WHERE conversation_id='ordered'"))[0].revision)).toBe(15);
    expect((await rows("SELECT * FROM agent_sync_events WHERE conversation_id='ordered'")).length).toBe(11);
  });

  it("isolates tenants and installations with identical conversation and event IDs", async () => {
    const payload = event(1, "isolated");
    await persistAgentEvent(1, payload);
    await persistAgentEvent(2, payload);
    await persistAgentEvent(1, { ...payload, installationId: randomUUID() });
    expect((await rows("SELECT * FROM agent_conversations WHERE conversation_id='isolated'")).length).toBe(3);
    expect((await rows("SELECT * FROM agent_sync_events WHERE event_id=?", [payload.eventId])).length).toBe(3);
  });

  it("treats case-distinct IDs separately", async () => {
    await persistAgentEvent(1, event(1, "Case"));
    await persistAgentEvent(1, event(2, "case"));
    expect((await rows("SELECT * FROM agent_conversations WHERE conversation_id IN ('Case','case')")).length).toBe(2);
  });

  it("rolls back the event receipt when snapshot persistence fails", async () => {
    await pool.query("ALTER TABLE agent_conversations ADD CONSTRAINT test_failure CHECK (revision <> 999)");
    const payload = event(999, "rollback");
    await expect(persistAgentEvent(1, payload)).rejects.toThrow();
    expect((await rows("SELECT * FROM agent_sync_events WHERE event_id=?", [payload.eventId])).length).toBe(0);
    await pool.query("ALTER TABLE agent_conversations DROP CHECK test_failure");
    await persistAgentEvent(1, payload);
  });

  it("persists a large snapshot beyond MySQL TEXT capacity", async () => {
    const payload = event(1, "large");
    payload.conversation.messages[0].text = "x".repeat(8 * 1024 * 1024 - 2048);
    await persistAgentEvent(1, payload);
    expect(Number((await rows("SELECT LENGTH(snapshot_json) AS bytes FROM agent_conversations WHERE conversation_id='large'"))[0].bytes)).toBeGreaterThan(8 * 1024 * 1024 - 2048);
  });

  it("lists bounded previews by customer and paginates details without crossing tenants", async () => {
    const payload = event(1, "read-pages");
    payload.conversation.messages = Array.from({ length: 52 }, (_, index) => ({ id: `message-${index}`, role: "user", text: `message-${index}` }));
    payload.conversation.messages[0].text = "x".repeat(1000);
    payload.conversation.tasks = Array.from({ length: 52 }, (_, index) => ({ id: `task-${index}`, status: "succeeded" }));
    await persistAgentEvent(2, payload);
    const listing = await listAgentConversations({ customerId: 2, page: 1, pageSize: 1 });
    expect(listing.total).toBe(2);
    expect(listing.items).toHaveLength(1);
    expect(listing.items.every(item => item.customerId === 2)).toBe(true);
    expect(listing.items[0]).not.toHaveProperty("snapshotJson");
    const all = await listAgentConversations({ customerId: 2, page: 1, pageSize: 20 });
    expect(all.items.find(item => item.conversationId === "read-pages")?.preview.length).toBe(160);
    const key = { customerId: 2, installationId, conversationId: "read-pages", messagePage: 2, taskPage: 2 };
    const detail = await getAgentConversation(key);
    expect(Math.abs(Date.now() - detail!.receivedAt.getTime())).toBeLessThan(5000);
    expect(all.items.find(item => item.conversationId === "read-pages")?.receivedAt).toEqual(detail!.receivedAt);
    expect(detail?.messages.map(message => message.id)).toEqual(["message-50", "message-51"]);
    expect(detail?.tasks).toHaveLength(2);
    expect(detail?.messageCount).toBe(52);
    expect(await getAgentConversation({ ...key, customerId: 1 })).toBeNull();
    expect(await getAgentConversation({ ...key, installationId: randomUUID() })).toBeNull();
    expect((await listAgentChatCustomers()).map(customer => customer.customerId)).toEqual([1, 2]);
  });
});
