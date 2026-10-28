import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import express from "express";
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import mysql, { type Pool, type Connection, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentSyncEventSchema } from "./agentSyncSchema";
import { aesEncrypt, generateLicenseKey } from "../shared/crypto";
import { authenticateLicenseUpload } from "./agentSyncStore";
import { AGENT_SYNC_PATH, registerAgentSync } from "./agentSync";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ getDb: async () => testDb }));
import { authenticateUpload, getAgentConversation, issueUploadCredential, listAgentChatCustomers, listAgentConversations, listUploadCredentials, persistAgentEvent, revokeUploadCredential } from "./agentSyncStore";

// Explicit opt-in. The fixture creates and drops only its own random database on a local test server.
const adminUrl = process.env.AGENT_SYNC_TEST_ADMIN_URL;
const localUrl = process.env.AGENT_SYNC_TEST_LOCAL_URL;
describe.skipIf(!adminUrl && !localUrl)("Agent sync MySQL transactions", () => {
  let admin: Connection;
  let pool: Pool;
  let createdDatabase = false;
  const temporaryTables = new Set<string>();
  const dbName = `agent_sync_test_${randomUUID().replaceAll("-", "")}`;
  const installationId = randomUUID();
  function event(revision = 1, conversationId = "conversation-test") {
    return agentSyncEventSchema.parse({ schemaVersion: 1, eventType: "agent.conversation.upsert", eventId: randomUUID(),
      installationId, conversationId, revision, occurredAt: "2026-09-22T06:30:00.000Z",
      conversation: { id: conversationId, messages: [{ id: "m1", role: "user", text: `revision-${revision}` }], tasks: [], attachments: [] },
    });
  }
  async function rows(query: string, args: unknown[] = []) { return (await pool.query<RowDataPacket[]>(query, args))[0]; }
  async function fixtureQuery(statement: string) {
    // One connection keeps the local-account fixtures temporary and isolated.
    if (adminUrl) return pool.query(statement);
    const create = /^\s*CREATE TABLE\s+`?(\w+)`?/i.exec(statement);
    if (create) {
      const result = await pool.query(statement.replace(/^\s*CREATE TABLE\b/i, "CREATE TEMPORARY TABLE"));
      temporaryTables.add(create[1].toLowerCase());
      return result;
    }
    const target = /^\s*(?:ALTER TABLE|INSERT INTO)\s+`?(\w+)`?/i.exec(statement)
      || /^\s*CREATE(?: UNIQUE)? INDEX\s+`?\w+`?\s+ON\s+`?(\w+)`?/i.exec(statement);
    if (!target || !temporaryTables.has(target[1].toLowerCase())) throw new Error("Fixture must target an existing temporary table");
    return pool.query(statement);
  }
  beforeAll(async () => {
    const url = new URL(adminUrl || localUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    if (adminUrl) {
      admin = await mysql.createConnection(adminUrl);
      await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
      createdDatabase = true;
      url.pathname = `/${dbName}`;
    }
    pool = mysql.createPool({ uri: url.toString(), connectionLimit: adminUrl ? 8 : 1 });
    if (!adminUrl) {
      let fixtureConnectionId: number | undefined;
      pool.on("connection", connection => {
        if (fixtureConnectionId !== undefined) connection.destroy();
        else fixtureConnectionId = connection.threadId;
      });
    }
    testDb = drizzle(pool);
    await fixtureQuery("CREATE TABLE customers (id int PRIMARY KEY, isActive boolean NOT NULL, name varchar(256))");
    await pool.query("INSERT INTO customers VALUES (1,1,'Customer A'),(2,1,'Customer B'),(3,0,'Inactive')");
    const migration = await readFile(new URL("../drizzle/0013_agent_chat_sync.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await fixtureQuery(statement);
    await fixtureQuery("CREATE TABLE licenseKeys (id int AUTO_INCREMENT PRIMARY KEY, keyString text, status varchar(32), expireTimestamp bigint, isDeleted boolean DEFAULT 0, customerId int, customerName varchar(256))");
    const sourceMigration = await readFile(new URL("../drizzle/0014_agent_chat_license_auth.sql", import.meta.url), "utf8");
    for (const statement of sourceMigration.split("--> statement-breakpoint")) await fixtureQuery(statement);
    const offlineSourceMigration = await readFile(new URL("../drizzle/0021_agent_chat_offline_sources.sql", import.meta.url), "utf8");
    for (const statement of offlineSourceMigration.split("--> statement-breakpoint")) await fixtureQuery(statement);
    const legacySourceMigration = await readFile(new URL("../drizzle/0026_agent_legacy_license_sources.sql", import.meta.url), "utf8");
    for (const statement of legacySourceMigration.split("--> statement-breakpoint")) await fixtureQuery(statement);
    const retentionMigration = await readFile(new URL("../drizzle/0022_upload_retention.sql", import.meta.url), "utf8");
    for (const statement of retentionMigration.split("--> statement-breakpoint").filter(statement => !statement.includes("usage_retention_received"))) await fixtureQuery(statement);
    await fixtureQuery("CREATE TABLE rsaKeyPairs (id int PRIMARY KEY, publicKey text)");
    await fixtureQuery("CREATE TABLE offlineKeys (id int PRIMARY KEY, productType varchar(32) DEFAULT 'shroom-desktop', activationCode text, status varchar(32), isDeleted boolean DEFAULT 0, customerId int, customerName varchar(256), expireDate bigint, rsaKeyPairId int)");
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      try { if (createdDatabase) await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``); }
      finally { await admin.end(); }
    }
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

  it("keeps a legacy source stable after registration and enforces authoritative company/status controls", async () => {
    const key = generateLicenseKey('car', 30, 'rental');
    const legacy = await authenticateLicenseUpload(key);
    await expect(authenticateLicenseUpload('invalid')).rejects.toMatchObject({ status: 401 });
    const [insert] = await pool.query<mysql.ResultSetHeader>("INSERT INTO licenseKeys (keyString,status,expireTimestamp,customerId) VALUES (?,'ISSUED',?,1)", [key, Date.now() + 86400000]);
    const principals = await Promise.all(Array.from({ length: 4 }, () => authenticateLicenseUpload(key)));
    const sourceId = principals[0].tenantId;
    expect(sourceId).toBe(legacy.tenantId);
    expect(principals.every(item => item.tenantId === sourceId)).toBe(true);
    expect(sourceId).not.toBe(1);
    await persistAgentEvent(sourceId, event(1, 'license-company'));
    expect((await listAgentConversations({ customerId: sourceId, page: 1, pageSize: 20 })).items[0].customerName).toBe('Customer A');
    await pool.query("UPDATE licenseKeys SET customerId=NULL, customerName='Contract Company' WHERE id=?", [insert.insertId]);
    expect((await authenticateLicenseUpload(key)).tenantId).toBe(sourceId);
    expect((await listAgentChatCustomers()).find(item => item.customerId === sourceId)?.name).toBe('Contract Company');
    await pool.query("UPDATE licenseKeys SET customerName=NULL WHERE id=?", [insert.insertId]);
    expect((await listAgentChatCustomers()).find(item => item.customerId === sourceId)?.name).toBe(`未绑定公司 · 密钥 #${insert.insertId}`);
    for (const status of ['SUSPENDED', 'REVOKED', 'TAMPERED', 'EXPIRED']) {
      await pool.query('UPDATE licenseKeys SET status=? WHERE id=?', [status, insert.insertId]);
      await expect(authenticateLicenseUpload(key)).rejects.toMatchObject({ status: 403 });
    }
    await pool.query("UPDATE licenseKeys SET status='ACTIVATED', isDeleted=1 WHERE id=?", [insert.insertId]);
    await expect(authenticateLicenseUpload(key)).rejects.toMatchObject({ status: 403 });
    await pool.query('UPDATE licenseKeys SET isDeleted=0, expireTimestamp=? WHERE id=?', [Date.now() - 1, insert.insertId]);
    await expect(authenticateLicenseUpload(key)).rejects.toMatchObject({ status: 403 });
    await pool.query("UPDATE licenseKeys SET expireTimestamp=?, customerId=3 WHERE id=?", [Date.now() + 86400000, insert.insertId]);
    await expect(authenticateLicenseUpload(key)).rejects.toMatchObject({ status: 403 });
    await pool.query("UPDATE licenseKeys SET customerId=999 WHERE id=?", [insert.insertId]);
    await expect(authenticateLicenseUpload(key)).rejects.toMatchObject({ status: 403 });
    await pool.query("UPDATE licenseKeys SET customerId=NULL, status='RENEWED' WHERE id=?", [insert.insertId]);
    expect((await authenticateLicenseUpload(key)).tenantId).toBe(sourceId);
  });

  it("isolates unbound licenses and honors database renewal of an expired encoded key", async () => {
    const expired = generateLicenseKey('car', -1, 'rental');
    const other = generateLicenseKey('car', 30, 'rental');
    for (const key of [expired, other]) await pool.query("INSERT INTO licenseKeys (keyString,status,expireTimestamp) VALUES (?,'RENEWED',?)", [key, Date.now() + 86400000]);
    const a = await authenticateLicenseUpload(expired), b = await authenticateLicenseUpload(other);
    expect(a.tenantId).not.toBe(b.tenantId);
    const payload = event(1, 'same-license-conversation');
    await persistAgentEvent(a.tenantId, payload);
    await persistAgentEvent(b.tenantId, payload);
    expect((await rows('SELECT * FROM agent_conversations WHERE conversation_id=?', [payload.conversationId])).length).toBe(2);
    expect((await authenticateUpload((await issueUploadCredential({ tenantId: 2, name: 'Legacy', days: 1, createdById: 1 })).token)).tenantId).toBe(2);
  });

  it("accepts a v1 key from a 1.1.40-style HTTP upload without registering or reissuing it", async () => {
    const key = aesEncrypt(JSON.stringify({ date: Date.now() + 86400000, file: "all" }));
    const licensesBefore = Number((await rows("SELECT COUNT(*) AS count FROM licenseKeys"))[0].count);
    const principals = await Promise.all(Array.from({ length: 4 }, () => authenticateLicenseUpload(key)));
    const sourceId = principals[0].tenantId;
    expect(principals.every(item => item.tenantId === sourceId)).toBe(true);
    const storedSources = await rows("SELECT * FROM agent_chat_sources WHERE id=?", [sourceId]);
    expect(storedSources[0].license_key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedSources[0].license_key_id).toBeNull();
    expect(JSON.stringify(storedSources)).not.toContain(key);
    expect(Number((await rows("SELECT COUNT(*) AS count FROM licenseKeys"))[0].count)).toBe(licensesBefore);
    const app = express();
    registerAgentSync(app);
    const server = createServer(app);
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const payload = { ...event(1, "legacy-http"), appVersion: "1.1.40" };
      const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${AGENT_SYNC_PATH}`, {
        method: "POST", headers: { Authorization: `License ${key}`, "Content-Type": "application/json", "Idempotency-Key": payload.eventId },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: true, eventId: payload.eventId });
      expect((await listAgentConversations({ customerId: sourceId, page: 1, pageSize: 20 })).items[0].customerName)
        .toBe(`未绑定公司 · 旧版密钥 #${sourceId}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
      });
    }
  });

  it("does not bypass a registered revoked legacy key by changing hex casing", async () => {
    const key = aesEncrypt(JSON.stringify({ date: Date.now() + 86400000, file: "car" }));
    await pool.query("INSERT INTO licenseKeys (keyString,status,expireTimestamp) VALUES (?,'REVOKED',?)", [key.toUpperCase(), Date.now() + 86400000]);
    await expect(authenticateLicenseUpload(key)).rejects.toMatchObject({ status: 403, code: "LICENSE_UNAVAILABLE" });
  });

  it("adopts pre-migration registered sources and keeps history when an unregistered key is later linked", async () => {
    const key = generateLicenseKey("seatpad", 30, "production");
    const [insert] = await pool.query<mysql.ResultSetHeader>("INSERT INTO licenseKeys (keyString,status,expireTimestamp,customerId) VALUES (?,'ISSUED',?,1)", [key, Date.now() + 86400000]);
    const [source] = await pool.query<mysql.ResultSetHeader>("INSERT INTO agent_chat_sources (license_key_id) VALUES (?)", [insert.insertId]);
    expect((await authenticateLicenseUpload(key)).tenantId).toBe(source.insertId);
    const legacy = aesEncrypt(JSON.stringify({ date: Date.now() + 86400000, file: "normal" }));
    const original = await authenticateLicenseUpload(legacy);
    await persistAgentEvent(original.tenantId, event(1, "legacy-later-linked"));
    await pool.query("INSERT INTO licenseKeys (keyString,status,expireTimestamp,customerId) VALUES (?,'ISSUED',?,1)", [legacy, Date.now() + 86400000]);
    expect((await authenticateLicenseUpload(legacy)).tenantId).toBe(original.tenantId);
    expect((await listAgentConversations({ customerId: original.tenantId, page: 1, pageSize: 20 })).items[0].customerName).toBe("Customer A");
  });

  it("isolates legacy hashes and rejects expired or formerly registered hard-deleted keys", async () => {
    const expiry = Date.now() + 86400000;
    const first = aesEncrypt(JSON.stringify({ date: expiry, file: "car" }));
    const second = aesEncrypt(JSON.stringify({ date: expiry, file: "hand" }));
    const a = await authenticateLicenseUpload(first), b = await authenticateLicenseUpload(second);
    expect(a.tenantId).not.toBe(b.tenantId);
    const payload = event(1, "legacy-isolated");
    await persistAgentEvent(a.tenantId, payload);
    await persistAgentEvent(b.tenantId, payload);
    expect((await rows("SELECT * FROM agent_conversations WHERE conversation_id='legacy-isolated'")).length).toBe(2);
    await expect(authenticateLicenseUpload(aesEncrypt(JSON.stringify({ date: Date.now() - 1, file: "all" })))).rejects.toMatchObject({ status: 403 });
    const [insert] = await pool.query<mysql.ResultSetHeader>("INSERT INTO licenseKeys (keyString,status,expireTimestamp) VALUES (?,'ISSUED',?)", [first, expiry]);
    expect((await authenticateLicenseUpload(first)).tenantId).toBe(a.tenantId);
    await pool.query("DELETE FROM licenseKeys WHERE id=?", [insert.insertId]);
    await expect(authenticateLicenseUpload(first)).rejects.toMatchObject({ status: 403, code: "LICENSE_UNAVAILABLE" });
  });

  it("keeps offline license sources stable and labels them through the linked customer", async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }), expireDate = Date.now() + 86400000;
    const payload = Buffer.from(JSON.stringify({ version: 4, boundSensorTypes: ['seatpad'], deviceLimit: 1, expireDate })).toString('base64');
    const signer = createSign('RSA-SHA256'); signer.update(payload); signer.end();
    const code = Buffer.from(JSON.stringify({ payload, signature: signer.sign(privateKey, 'base64') })).toString('base64');
    await pool.query('INSERT INTO rsaKeyPairs VALUES (7,?)', [publicKey.export({ type: 'spki', format: 'pem' }).toString()]);
    await pool.query("INSERT INTO offlineKeys (id,activationCode,status,customerId,expireDate,rsaKeyPairId) VALUES (7,?,'ISSUED',1,?,7)", [code, expireDate]);
    const first = await authenticateLicenseUpload(code), second = await authenticateLicenseUpload(code);
    expect(first.tenantId).toBe(second.tenantId);
    expect((await rows('SELECT * FROM agent_chat_sources WHERE id=?', [first.tenantId]))[0].offline_key_id).toBe(7);
    await persistAgentEvent(first.tenantId, event(1, 'offline-company'));
    expect((await listAgentConversations({ customerId: first.tenantId, page: 1, pageSize: 20 })).items[0].customerName).toBe('Customer A');
    await pool.query('UPDATE offlineKeys SET customerId=2 WHERE id=7');
    expect((await authenticateLicenseUpload(code)).tenantId).toBe(first.tenantId);
    await pool.query("UPDATE offlineKeys SET status='REVOKED' WHERE id=7");
    await expect(authenticateLicenseUpload(code)).rejects.toMatchObject({ status: 403 });
  });
});
