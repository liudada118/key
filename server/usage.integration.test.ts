import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { usageEventSchema, type UsageEvent } from "./usageSchema";
import { generateLicenseKey } from "../shared/crypto";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ getDb: async () => testDb }));
import { authenticateUsage, getUsageEventContext, getUsageOverview, listUsageEvents, persistUsageBatch } from "./usageStore";
const adminUrl = process.env.USAGE_TEST_ADMIN_URL;

describe.skipIf(!adminUrl)("usage MySQL transaction and attribution", () => {
  let admin: Connection, pool: Pool;
  const databaseName = `usage_test_${randomUUID().replaceAll("-", "")}`;
  const principal = { sourceId: 100, customerId: 1, customerName: "Original Company" };
  const filters = { from: "2026-09-24", to: "2026-09-24", environment: "test" as const };
  /** Construct a parsed event containing only synthetic identifiers and values. */
  function event(patch: Partial<UsageEvent> = {}) {
    return usageEventSchema.parse({ schemaVersion: 1, eventId: randomUUID(), installationId: randomUUID(), sessionId: randomUUID(),
      occurredAt: "2026-09-24T06:30:00.000Z", appVersion: "1.2.3", environment: "test", eventName: "export_result",
      properties: { featureId: "export", result: "success", format: "csv" }, ...patch });
  }
  /** Read records from the isolated fixture database. */
  async function rows(query: string, args: unknown[] = []) { return (await pool.query<RowDataPacket[]>(query, args))[0]; }
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    url.pathname = `/${databaseName}`;
    pool = mysql.createPool({ uri: url.toString(), connectionLimit: 8 });
    testDb = drizzle(pool);
    await pool.query("CREATE TABLE customers (id int PRIMARY KEY, isActive boolean NOT NULL, name varchar(256))");
    await pool.query("INSERT INTO customers VALUES (1,1,'Company A'),(2,1,'Company B'),(3,0,'Inactive')");
    await pool.query("CREATE TABLE licenseKeys (id int AUTO_INCREMENT PRIMARY KEY, keyString text, status varchar(32), expireTimestamp bigint, isDeleted boolean DEFAULT 0, customerId int, customerName varchar(256))");
    for (const file of ["0013_agent_chat_sync.sql", "0014_agent_chat_license_auth.sql", "0015_usage_analytics.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
    }
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); await admin.end(); }
  });

  it("deduplicates concurrent retries and rejects changed bodies without overwriting", async () => {
    const payload = event();
    await Promise.all(Array.from({ length: 5 }, () => persistUsageBatch(principal, [payload])));
    expect((await rows("SELECT * FROM usage_events WHERE event_id=?", [payload.eventId]))).toHaveLength(1);
    await expect(persistUsageBatch(principal, [{ ...payload, properties: { result: "failure" } }])).rejects.toMatchObject({ status: 409 });
    expect(JSON.parse((await rows("SELECT payload_json FROM usage_events WHERE event_id=?", [payload.eventId]))[0].payload_json)).toEqual(payload);
  });

  it("rolls back all new events when any receipt in the batch conflicts", async () => {
    const existing = event({ eventId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    await persistUsageBatch(principal, [existing]);
    const fresh = event({ installationId: existing.installationId, eventId: "00000000-0000-4000-8000-000000000001" });
    await expect(persistUsageBatch(principal, [fresh, { ...existing, appVersion: "changed" }])).rejects.toMatchObject({ status: 409 });
    expect(await rows("SELECT event_id FROM usage_events WHERE event_id=?", [fresh.eventId])).toHaveLength(0);
    await persistUsageBatch(principal, [fresh, existing]);
    expect(await rows("SELECT event_id FROM usage_events WHERE event_id=?", [fresh.eventId])).toHaveLength(1);
  });

  it("separates identical IDs by source/install and preserves historical customer attribution", async () => {
    const payload = event();
    await persistUsageBatch(principal, [payload]);
    await persistUsageBatch({ sourceId: 101, customerId: 2, customerName: "Company B" }, [payload]);
    await persistUsageBatch(principal, [{ ...payload, installationId: randomUUID() }]);
    await persistUsageBatch({ ...principal, customerId: 2, customerName: "Reassigned" }, [event()]);
    expect(await rows("SELECT event_id FROM usage_events WHERE event_id=?", [payload.eventId])).toHaveLength(3);
    expect((await rows("SELECT * FROM usage_sources WHERE source_id=100"))[0]).toMatchObject({ customer_id: 1, customer_name: "Original Company" });
    const listing = await listUsageEvents({ filters: { ...filters, customerKey: "customer:2" }, errorsOnly: false, page: 1 });
    expect(listing.items).toHaveLength(1);
    expect(listing.items[0].sourceId).toBe(101);
  });

  it("sums repeated errors, scrubs sensitive text, and limits context to the same session/install/source", async () => {
    const scope = { sourceId: 102, customerId: 10, customerName: "Errors" };
    const start = event({ eventName: "collection_started" });
    const error = event({ installationId: start.installationId, sessionId: start.sessionId,
      occurredAt: "2026-09-24T06:31:00.000Z", eventName: "error_reported",
      properties: { module: "collection", errorType: "WriteError", message: "token=private failure", count: 4 } });
    await persistUsageBatch(scope, [start, error, event({ installationId: start.installationId }),
      event({ sessionId: start.sessionId }), event({ ...error, eventId: randomUUID(), occurredAt: "2026-09-24T06:32:00.000Z", properties: { ...error.properties, count: 2 } })]);
    await persistUsageBatch({ ...scope, sourceId: 103, customerId: 11 }, [error]);
    const summary = await getUsageOverview({ ...filters, customerKey: "customer:10" });
    expect(summary.totals.errors).toBe(6);
    expect(summary.totals.uniqueErrors).toBe(1);
    const context = await getUsageEventContext({ sourceId: 102, installationId: error.installationId, eventId: error.eventId });
    expect(context?.map(item => item.eventId)).toEqual([start.eventId, error.eventId]);
    expect(JSON.stringify(context)).not.toContain("private");
    expect(await getUsageEventContext({ sourceId: 999, installationId: error.installationId, eventId: error.eventId })).toBeNull();
    // Different secrets are still different request contents, even when their stored redaction matches.
    await expect(persistUsageBatch(scope, [{ ...error, properties: { ...error.properties, message: "token=other failure" } }])).rejects.toMatchObject({ status: 409 });
  });

  it("authenticates only usable registered licenses and fixes company attribution at first durable upload", async () => {
    const key = generateLicenseKey("car", 30, "rental");
    await expect(authenticateUsage(key)).rejects.toMatchObject({ status: 401 });
    const [insert] = await pool.query<mysql.ResultSetHeader>("INSERT INTO licenseKeys (keyString,status,expireTimestamp,customerId) VALUES (?,'ISSUED',?,1)", [key, Date.now() + 86400000]);
    const first = await authenticateUsage(key);
    expect(first.customerId).toBe(1);
    await persistUsageBatch(first, [event()]);
    await pool.query("UPDATE licenseKeys SET customerId=2 WHERE id=?", [insert.insertId]);
    const rebound = await authenticateUsage(key);
    expect(rebound.sourceId).toBe(first.sourceId);
    await persistUsageBatch(rebound, [event()]);
    expect((await rows("SELECT customer_id FROM usage_sources WHERE source_id=?", [first.sourceId]))[0].customer_id).toBe(1);
    for (const status of ["SUSPENDED", "REVOKED", "TAMPERED", "EXPIRED"]) {
      await pool.query("UPDATE licenseKeys SET status=? WHERE id=?", [status, insert.insertId]);
      await expect(authenticateUsage(key)).rejects.toMatchObject({ status: 403 });
    }
    await pool.query("UPDATE licenseKeys SET status='ACTIVATED', customerId=3 WHERE id=?", [insert.insertId]);
    await expect(authenticateUsage(key)).rejects.toMatchObject({ status: 403 });
  });
});
