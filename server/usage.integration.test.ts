import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { usageEventSchema, type UsageEvent } from "./usageSchema";
import { generateLicenseKey } from "../shared/crypto";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ getDb: async () => testDb }));
import { authenticateUsage, getUsageDashboard, getUsageAnalysisSummary, getUsageEventContext, getUsageOverview,
  listUsageCustomerUsage, listUsageEvents, listUsageFeatureUsage, listUsageSystems, persistUsageBatch } from "./usageStore";
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
    await pool.query("CREATE TABLE offlineKeys (id int PRIMARY KEY, customerId int, customerName varchar(256))");
    for (const file of ["0013_agent_chat_sync.sql", "0014_agent_chat_license_auth.sql", "0015_usage_analytics.sql", "0021_agent_chat_offline_sources.sql", "0022_upload_retention.sql"]) {
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
  it("uses full-scope business evidence and UTC buckets for dashboard trends and rankings", async () => {
    const scope = { sourceId: 4901, customerId: 4901, customerName: "Dashboard Fixture" };
    const sample = event({ eventName: "monitoring_usage_summary", occurredAt: "2026-09-25T23:59:59Z",
      properties: { featureId: "monitoring", durationMs: 120000, systemType: "foot" } });
    await persistUsageBatch(scope, [sample, sample]);
    await persistUsageBatch(scope, [event({ eventName: "feature_exposed", occurredAt: "2026-09-26T00:00:00Z", properties: { featureId: "export" } }),
      event({ eventName: "error_reported", occurredAt: "2026-09-26T00:00:00Z", properties: { module: "export", message: "synthetic", count: 3 } })]);
    const scoped = { from: "2026-09-25", to: "2026-09-26", environment: "test" as const, customerKey: "customer:4901" };
    const result = await getUsageDashboard(scoped);
    expect(result.days).toEqual([
      { day: Date.parse("2026-09-25") / 86400000, usedCustomers: 1, monitoringMs: 120000, errors: 0 },
      { day: Date.parse("2026-09-26") / 86400000, usedCustomers: 0, monitoringMs: 0, errors: 3 },
    ]);
    expect(result.features.find(row => row.featureId === "monitoring")).toMatchObject({ usedCustomers: 1, uses: 1 });
    expect(result.features.find(row => row.featureId === "export")).toMatchObject({ usedCustomers: 0, uses: 0 });
    expect(result.customers).toEqual([{ customerKey: "customer:4901", customerName: "Dashboard Fixture", monitoringMs: 120000, uses: 1 }]);
    expect((await getUsageDashboard({ ...scoped, environment: "production" })).days).toEqual([]);
    expect((await getUsageDashboard({ ...scoped, featureId: "export" })).days.every(row => row.usedCustomers === 0)).toBe(true);
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

  it("separates performance units, active windows and pseudonymous system groups", async () => {
    const scope = { sourceId: 104, customerId: 12, customerName: "Coverage" };
    const installationId = randomUUID(), sessionId = randomUUID();
    const make = (eventName: UsageEvent["eventName"], properties: UsageEvent["properties"]) => event({ eventName, properties, installationId, sessionId });
    await persistUsageBatch(scope, [
      make("system_entered", { systemType: "custom.0123456789abcdef", systemOrigin: "custom" }),
      make("system_entered", { systemType: "custom.fedcba9876543210", systemOrigin: "custom" }),
      make("monitoring_usage_summary", { systemType: "custom.0123456789abcdef", featureId: "monitoring", durationMs: 30000 }),
      make("usage_session_summary", { featureId: "foreground", durationMs: 60000 }),
      make("usage_session_summary", { featureId: "interaction", durationMs: 15000 }),
      make("usage_session_summary", { featureId: "main_memory", count: 512 }),
    ]);
    const data = await getUsageOverview({ ...filters, customerKey: "customer:12" });
    expect(data.customers[0]).toMatchObject({ monitoringMs: 30000, foregroundMs: 60000, interactionMs: 15000 });
    expect(data.systems).toHaveLength(2);
    expect(data.systems.find(row => row.systemType === "custom.0123456789abcdef")).toMatchObject({ entries: 1, monitoringMs: 30000 });
    const selected = await listUsageEvents({ filters: { ...filters, customerKey: "customer:12", featureId: "main_memory" }, errorsOnly: false, page: 1 });
    expect(selected.total).toBe(1); expect(selected.items[0].event.properties.count).toBe(512);
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

  it("groups a feature across event types, deduplicates operations and counts customers only once", async () => {
    const installationId = randomUUID(), sessionId = randomUUID();
    const make = (eventName: UsageEvent["eventName"], properties: UsageEvent["properties"]) => event({
      eventName, properties, installationId, sessionId, occurredAt: "2026-10-01T10:00:00Z" });
    const source = { sourceId: 501, customerId: 41, customerName: "Feature Company" };
    await persistUsageBatch(source, [
      ...Array.from({ length: 3 }, () => make("feature_exposed", { featureId: "export" })),
      make("feature_attempted", { featureId: "export", operationId: "export-1", result: "success" }),
      make("feature_attempted", { featureId: "export", operationId: "export-1" }),
      make("export_result", { featureId: "export", operationId: "export-1", result: "success" }),
      make("export_result", { featureId: "export", operationId: "export-1", result: "success" }),
      make("export_result", { featureId: "export", operationId: "export-2", result: "failure" }),
      make("export_result", { featureId: "export", operationId: "export-3", result: "cancelled" }),
      make("export_result", { featureId: "export", operationId: "export-4" }),
      make("error_reported", { featureId: "export", count: 5 }),
    ]);
    await persistUsageBatch({ ...source, sourceId: 502 }, [make("export_result", { featureId: "export", operationId: "export-1", result: "success" })]);
    await persistUsageBatch({ sourceId: 503, customerId: 42, customerName: "Exposure Only" }, [make("feature_exposed", { featureId: "export" })]);
    const scoped = { ...filters, from: "2026-10-01", to: "2026-10-01", identityScope: "company" as const };
    const features = await listUsageFeatureUsage({ filters: scoped, page: 1, sort: "usage", category: "business" });
    expect(features.total).toBe(1);
    expect(features.items[0]).toMatchObject({ featureId: "export", observedCustomers: 2, usedCustomers: 1,
      attempts: 1, exposures: 4, successes: 2, failures: 1, cancelled: 1, unknownResults: 1, uses: 2, errors: 5 });
    const customers = await listUsageCustomerUsage({ filters: { ...scoped, featureId: "export" }, page: 1, sort: "recent" });
    expect(customers.total).toBe(2);
    expect(customers.items.find(row => row.customerKey === "customer:42")).toMatchObject({ usedCustomers: 0, uses: 0, lastUsedMs: null });
    expect((await getUsageAnalysisSummary(scoped))).toMatchObject({ observedCustomers: 2, usedCustomers: 1, errorCustomers: 1, errors: 5 });
  });

  it("does not call attempts, failures, visits or performance summaries successful business use", async () => {
    const scope = { sourceId: 511, customerId: 43, customerName: "No Confirmed Use" };
    const make = (eventName: UsageEvent["eventName"], properties: UsageEvent["properties"]) => event({ eventName, properties, occurredAt: "2026-10-02T12:00:00Z" });
    await persistUsageBatch(scope, [make("feature_exposed", { featureId: "collection" }),
      make("feature_attempted", { featureId: "collection" }), make("collection_started", { featureId: "collection" }),
      make("collection_finished", { featureId: "collection", durationMs: 30000 }),
      make("export_result", { featureId: "export", result: "failure" }),
      make("system_entered", { systemType: "hand" }),
      make("monitoring_usage_summary", { featureId: "monitoring", durationMs: 0 }),
      make("usage_session_summary", { featureId: "foreground", durationMs: 60000 }),
      make("usage_session_summary", { featureId: "main_memory", count: 512 }),
      make("error_reported", { count: 3 }),
    ]);
    const scoped = { ...filters, from: "2026-10-02", to: "2026-10-02" };
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ usedCustomers: 0, monitoringMs: 0,
      monitoringSamples: 1, collectionMs: 30000, errors: 3 });
    const diagnostic = await listUsageFeatureUsage({ filters: scoped, page: 1, sort: "usage", category: "diagnostic" });
    expect(diagnostic.items.map(item => item.featureId).sort()).toEqual(["foreground", "main_memory"]);
    expect(diagnostic.items.every(item => item.usedCustomers === 0)).toBe(true);
    const business = await listUsageFeatureUsage({ filters: scoped, page: 1, sort: "usage", category: "business" });
    expect(business.items.find(item => item.featureId === "collection")).toMatchObject({ uses: 0, successes: 0, unknownResults: 1 });
  });

  it("keeps legacy feature identity consistent across detail, event and system queries", async () => {
    const scope = { sourceId: 521, customerId: 44, customerName: "Legacy Feature" };
    await persistUsageBatch(scope, [
      event({ eventName: "collection_finished", occurredAt: "2026-10-03T12:00:00Z", properties: { result: "success", durationMs: 12000, systemType: "custom.0123456789abcdef" } }),
      event({ eventName: "error_reported", occurredAt: "2026-10-03T12:01:00Z", properties: { module: "collection", count: 7 } }),
    ]);
    const scoped = { ...filters, from: "2026-10-03", to: "2026-10-03", featureId: "collection" };
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ usedCustomers: 1, collectionMs: 12000, errors: 0, monitoringSamples: 0 });
    const list = await listUsageEvents({ filters: scoped, errorsOnly: false, page: 1 });
    expect(list.total).toBe(1); expect(list.items[0].event.eventName).toBe("collection_finished");
    const systems = await listUsageSystems(scoped);
    expect(systems).toHaveLength(1); expect(systems[0].systemType).toBe("custom.0123456789abcdef");
    expect((await listUsageEvents({ filters: { ...scoped, systemType: "hand" }, errorsOnly: false, page: 1 })).total).toBe(0);
  });

  it("separates company identities from each unbound source without silently changing legacy scope", async () => {
    const payload = () => event({ occurredAt: "2026-10-04T12:00:00Z" });
    for (const sourceId of [531, 532]) await persistUsageBatch({ sourceId, customerId: null, customerName: "Unbound" }, [payload()]);
    await persistUsageBatch({ sourceId: 533, customerId: 45, customerName: "Company" }, [payload()]);
    const scoped = { ...filters, from: "2026-10-04", to: "2026-10-04" };
    expect((await getUsageAnalysisSummary(scoped)).observedCustomers).toBe(3);
    expect((await getUsageAnalysisSummary({ ...scoped, identityScope: "company" })).observedCustomers).toBe(1);
    expect((await getUsageAnalysisSummary({ ...scoped, identityScope: "unbound" })).observedCustomers).toBe(2);
    const unbound = await listUsageCustomerUsage({ filters: { ...scoped, identityScope: "unbound" }, page: 1, sort: "recent" });
    expect(unbound.items.map(row => row.customerKey).sort()).toEqual(["source:531", "source:532"]);
  });

  it("paginates grouped features and customers while keeping totals full-scope and clamping stale pages", async () => {
    for (let index = 0; index < 21; index++) await persistUsageBatch({ sourceId: 551 + index, customerId: 100 + index, customerName: `Page Company ${index}` }, [
      event({ occurredAt: "2026-10-05T12:00:00Z", eventName: "analysis_tool_used", properties: { featureId: `feature_test_${index}`, result: "success" } }),
    ]);
    const scoped = { ...filters, from: "2026-10-05", to: "2026-10-05" };
    const first = await listUsageFeatureUsage({ filters: scoped, page: 1, sort: "usage", category: "business" });
    const last = await listUsageFeatureUsage({ filters: scoped, page: 99, sort: "usage", category: "business" });
    expect(first.total).toBe(21); expect(first.items).toHaveLength(20);
    expect(last.page).toBe(2); expect(last.items).toHaveLength(1);
    const clients = await listUsageCustomerUsage({ filters: scoped, page: 2, sort: "recent" });
    expect(clients.total).toBe(21); expect(clients.items).toHaveLength(1);
    expect((await getUsageAnalysisSummary(scoped)).usedCustomers).toBe(21);
    const empty = await getUsageAnalysisSummary({ ...scoped, customerKey: "customer:99999" });
    expect(empty).toMatchObject({ observedCustomers: 0, usedCustomers: 0, monitoringMs: 0, monitoringSamples: 0, errors: 0 });
  });

  it("keeps UTC boundaries, versions, environments and system filters aligned in every view", async () => {
    const scope = { sourceId: 581, customerId: 130, customerName: "Boundary" };
    await persistUsageBatch(scope, [
      event({ occurredAt: "2026-10-06T23:59:59Z", properties: { featureId: "export", result: "success", systemType: "hand" } }),
      event({ occurredAt: "2026-10-07T00:00:00Z", properties: { featureId: "export", result: "success", systemType: "hand" } }),
      event({ occurredAt: "2026-10-06T22:00:00Z", environment: "production", properties: { featureId: "export", result: "success", systemType: "hand" } }),
    ]);
    const scoped = { ...filters, from: "2026-10-06", to: "2026-10-06", appVersion: "1.2.3", systemType: "hand" };
    expect((await getUsageAnalysisSummary(scoped)).observedEvents).toBe(1);
    expect((await listUsageFeatureUsage({ filters: scoped, page: 1, sort: "usage", category: "business" })).items[0].successes).toBe(1);
    expect((await listUsageCustomerUsage({ filters: { ...scoped, appVersion: "missing" }, page: 1, sort: "recent" })).items).toHaveLength(0);
  });
});
