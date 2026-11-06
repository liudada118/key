import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { usageEventSchema, type UsageEvent } from "./usageSchema";
import { generateLicenseKey } from "../shared/crypto";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ getDb: async () => testDb }));
import { authenticateUsage, persistUsageBatch } from "./usageStore";
import * as usageStore from "./usageStore";
const fullScope = { kind: "all" } as const;
const getUsageCollectionOutcome = usageStore.getUsageCollectionOutcome.bind(null, fullScope);
const getUsageDashboard = usageStore.getUsageDashboard.bind(null, fullScope);
const getUsageAnalysisSummary = usageStore.getUsageAnalysisSummary.bind(null, fullScope);
const getUsageEventContext = usageStore.getUsageEventContext.bind(null, fullScope);
const getUsageOverview = usageStore.getUsageOverview.bind(null, fullScope);
const listUsageCustomers = usageStore.listUsageCustomers.bind(null, fullScope);
const listUsageCustomerUsage = usageStore.listUsageCustomerUsage.bind(null, fullScope);
const listUsageEvents = usageStore.listUsageEvents.bind(null, fullScope);
const listUsageFeatureUsage = usageStore.listUsageFeatureUsage.bind(null, fullScope);
const listUsageSystems = usageStore.listUsageSystems.bind(null, fullScope);
import { licenseCustomerDisplayName, licenseInternalUse } from "./keyCustomerAttribution";
import { licenseKeys } from "../drizzle/schema";
import { eq } from "drizzle-orm";
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
    await pool.query("CREATE TABLE licenseKeys (id int AUTO_INCREMENT PRIMARY KEY, keyString text, status varchar(32), expireTimestamp bigint, isDeleted boolean DEFAULT 0, customerId int, customerName varchar(256), createdById int, createdByName varchar(128), contractId int, contractNo varchar(128), generationRequestId int, remark text)");
    await pool.query("CREATE TABLE keyGenerationRequests (id int PRIMARY KEY, reason text)");
    await pool.query("CREATE TABLE offlineKeys (id int PRIMARY KEY, customerId int, customerName varchar(256), createdById int)");
    for (const file of ["0013_agent_chat_sync.sql", "0014_agent_chat_license_auth.sql", "0015_usage_analytics.sql", "0021_agent_chat_offline_sources.sql", "0022_upload_retention.sql", "0026_agent_legacy_license_sources.sql", "0027_usage_collection_revisions.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
    }
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); await admin.end(); }
  });

  it("scopes every aggregate before grouping even when issuers share a customer", async () => {
    const owner = { kind: "issuer", issuerId: 41 } as const;
    const scoped = { from: "2026-11-06", to: "2026-11-06", environment: "test" as const, identityScope: "all" as const };
    for (const [id, issuerId, customerId] of [[7301, 41, 1], [7302, 42, 1], [7303, 42, 2], [7304, 41, null]]) {
      await pool.query("INSERT INTO licenseKeys (id,createdById,customerId,createdByName,remark) VALUES (?,?,?,'Issuer Fixture',?)",
        [id, issuerId, customerId, customerId === null ? "自用" : null]);
      await pool.query("INSERT INTO agent_chat_sources (id,license_key_id) VALUES (?,?)", [id, id]);
    }
    await pool.query("INSERT INTO offlineKeys (id,customerId,createdById) VALUES (7305,1,41)");
    await pool.query("INSERT INTO agent_chat_sources (id,offline_key_id) VALUES (7305,7305)");
    // Deliberately reuse the same event/installation IDs: source identity must never be omitted.
    const shared = event({ occurredAt: "2026-11-06T06:00:00Z", properties: { featureId: "export", result: "success", format: "csv", systemType: "jqbed" } });
    for (const sourceId of [7301, 7302, 7303, 7304, 7305, 7306]) {
      await persistUsageBatch({ sourceId, customerId: 1, customerName: "Shared snapshot" }, [shared]);
    }
    expect((await usageStore.listUsageCustomers(owner)).map(row => row.customerKey).sort()).toEqual(["customer:1", "source:7304"]);
    expect(await usageStore.getUsageAnalysisSummary(owner, scoped)).toMatchObject({ usedCustomers: 2, uses: 3, installations: 3, observedEvents: 3 });
    const dashboard = await usageStore.getUsageDashboard(owner, scoped);
    expect(dashboard.days).toHaveLength(1);
    expect(dashboard.days[0].usedCustomers).toBe(2);
    expect(dashboard.features[0]).toMatchObject({ featureId: "export", usedCustomers: 2, uses: 3 });
    expect(dashboard.customers.find(row => row.customerKey === "customer:1")?.uses).toBe(2);
    const list = { filters: scoped, page: 1, sort: "recent" as const };
    expect((await usageStore.listUsageFeatureUsage(owner, { ...list, category: "all" })).items[0]).toMatchObject({ uses: 3, installations: 3 });
    const customers = await usageStore.listUsageCustomerUsage(owner, list);
    expect(customers.total).toBe(2);
    expect(customers.items.find(row => row.customerKey === "customer:1")).toMatchObject({ uses: 2, installations: 2 });
    expect((await usageStore.listUsageSystems(owner, scoped))[0]).toMatchObject({ events: 3, installations: 3, customers: 2 });
    expect((await usageStore.getUsageOverview(owner, scoped)).totals).toMatchObject({ events: 3, installations: 3, customers: 2 });
    const events = await usageStore.listUsageEvents(owner, { filters: scoped, errorsOnly: false, page: 999 });
    expect(events).toMatchObject({ total: 3, page: 1 });
    expect(events.items.map(row => row.sourceId).sort()).toEqual([7301, 7304, 7305]);
    for (const sourceId of [7301, 7305]) {
      expect(await usageStore.getUsageEventContext(owner, { sourceId, installationId: shared.installationId, eventId: shared.eventId })).toHaveLength(1);
    }
    for (const sourceId of [7302, 7303, 7306]) {
      expect(await usageStore.getUsageEventContext(owner, { sourceId, installationId: shared.installationId, eventId: shared.eventId })).toBeNull();
    }
    for (const customerKey of ["customer:2", "source:7306"]) {
      expect(await usageStore.getUsageAnalysisSummary(owner, { ...scoped, customerKey })).toMatchObject({ uses: 0, observedEvents: 0 });
      expect((await usageStore.listUsageEvents(owner, { filters: { ...scoped, customerKey }, errorsOnly: false, page: 1 })).total).toBe(0);
    }
    const emptyScope = { kind: "issuer", issuerId: 43 } as const;
    expect(await usageStore.listUsageCustomers(emptyScope)).toEqual([]);
    expect(await usageStore.getUsageAnalysisSummary(emptyScope, scoped)).toMatchObject({ uses: 0, observedCustomers: 0 });
    expect(await usageStore.getUsageDashboard(emptyScope, scoped)).toEqual({ days: [], features: [], customers: [] });
    expect((await usageStore.getUsageOverview(fullScope, scoped)).totals.events).toBe(6);
    expect((await usageStore.getUsageOverview({ kind: "issuer", issuerId: 42 }, scoped)).totals.events).toBe(2);
  });

  it("guards collection receipts and error bodies by online/offline issuer, not shared IDs", async () => {
    const owner = { kind: "issuer", issuerId: 51 } as const;
    for (const [id, createdById] of [[7401, 51], [7402, 52]]) {
      await pool.query("INSERT INTO licenseKeys (id,createdById,customerId) VALUES (?,?,1)", [id, createdById]);
      await pool.query("INSERT INTO agent_chat_sources (id,license_key_id) VALUES (?,?)", [id, id]);
    }
    await pool.query("INSERT INTO offlineKeys (id,createdById,customerId) VALUES (7403,51,1)");
    await pool.query("INSERT INTO agent_chat_sources (id,offline_key_id) VALUES (7403,7403)");
    const shared = event({ schemaVersion: 2, occurredAt: "2026-11-07T06:00:00.000Z", eventName: "collection_finished", properties: {
      featureId: "collection", collectionId: "shared-outcome", outcome: "saved", result: "success", outcomeRevision: 0,
      stopReason: "user", committedRows: 8, failedRows: 0, frameCount: 8, durationMs: 1000 } });
    const error = event({ occurredAt: shared.occurredAt, installationId: shared.installationId, sessionId: shared.sessionId,
      eventName: "error_reported", properties: { featureId: "collection", errorCode: "SYNTHETIC", message: "Fixture error" } });
    for (const sourceId of [7401, 7402, 7403]) await persistUsageBatch({ sourceId, customerId: 1, customerName: "Shared" }, [shared, error]);
    const identity = { installationId: shared.installationId, collectionId: "shared-outcome" };
    for (const sourceId of [7401, 7403]) {
      expect(await usageStore.getUsageCollectionOutcome(owner, { ...identity, sourceId })).toMatchObject({ complete: true, event: shared });
    }
    expect(await usageStore.getUsageCollectionOutcome(owner, { ...identity, sourceId: 7402 })).toBeNull();
    expect(await usageStore.getUsageEventContext(owner, { sourceId: 7402, installationId: error.installationId, eventId: error.eventId })).toBeNull();
    const scoped = { from: "2026-11-07", to: "2026-11-07", environment: "test" as const, identityScope: "all" as const };
    expect(await usageStore.getUsageAnalysisSummary(owner, scoped)).toMatchObject({ errors: 2, successes: 2, collectionMs: 2000 });
    expect((await usageStore.listUsageEvents(owner, { filters: scoped, errorsOnly: true, page: 1 })).items.map(row => row.sourceId).sort()).toEqual([7401, 7403]);
    await pool.query("DELETE FROM usage_events WHERE source_id=7402");
    expect(await usageStore.getUsageCollectionOutcome(owner, { ...identity, sourceId: 7402 })).toBeNull();
    expect(await usageStore.getUsageCollectionOutcome(fullScope, { ...identity, sourceId: 7402 })).toMatchObject({ contentUnavailable: true });
  });

  it("resolves historical no-contract notes, self use and later bindings consistently without rewriting receipts", async () => {
    const scoped = { from: "2026-11-04", to: "2026-11-04", environment: "test" as const };
    for (const [id, reason] of [[7101, "客户甲试用"], [7102, "销售自用"], [7103, ""], [7104, "客户甲试用"]] as const) {
      await pool.query("INSERT INTO keyGenerationRequests VALUES (?,?)", [id, reason]);
      await pool.query("INSERT INTO licenseKeys (id,createdByName,generationRequestId) VALUES (?, '测试账号', ?)", [id, id]);
      await pool.query("INSERT INTO agent_chat_sources (id,license_key_id) VALUES (?,?)", [id, id]);
      await persistUsageBatch({ sourceId: id, customerId: null, customerName: `未绑定公司 · 密钥 #${id}` }, [event({ occurredAt: "2026-11-04T09:00:00Z" })]);
    }
    const company = { ...scoped, identityScope: "company" as const };
    expect(await getUsageAnalysisSummary(company)).toMatchObject({ usedCustomers: 2, uses: 2 });
    expect(await getUsageAnalysisSummary({ ...scoped, identityScope: "self" })).toMatchObject({ usedCustomers: 1 });
    expect(await getUsageAnalysisSummary({ ...scoped, identityScope: "unbound" })).toMatchObject({ usedCustomers: 1 });
    expect(await getUsageAnalysisSummary({ ...scoped, identityScope: "all" })).toMatchObject({ usedCustomers: 4 });
    expect((await listUsageCustomers()).filter(r => r.customerKey === "source:7102"))
      .toEqual([{ customerKey: "source:7102", customerName: "测试账号 · 自用", identityScope: "self" }]);
    expect((await listUsageCustomerUsage({ filters: company, page: 1, sort: "recent" })).items.map(r => r.customerName))
      .toEqual(["客户甲试用", "客户甲试用"]); // Same notes are not proof of the same customer.
    expect((await getUsageDashboard(company)).customers).toHaveLength(2);
    expect((await listUsageEvents({ filters: company, errorsOnly: false, page: 1 })).total).toBe(2);
    const [name] = await testDb.select({ name: licenseCustomerDisplayName, self: licenseInternalUse }).from(licenseKeys).where(eq(licenseKeys.id, 7102));
    expect(name).toEqual({ name: "测试账号", self: 1 });
    await pool.query("UPDATE licenseKeys SET customerId=2,customerName='Explicit Company' WHERE id=7102");
    expect(await getUsageAnalysisSummary(company)).toMatchObject({ usedCustomers: 3 });
    expect(await getUsageAnalysisSummary({ ...scoped, identityScope: "self" })).toMatchObject({ usedCustomers: 0 });
    expect((await listUsageCustomers()).find(r => r.customerKey === "customer:2")?.customerName).toBe("Company B");
    expect((await rows("SELECT customer_id,customer_name FROM usage_sources WHERE source_id=7102"))[0])
      .toEqual({ customer_id: null, customer_name: "未绑定公司 · 密钥 #7102" });
  });

  it("shows later installation verification across sessions and filter boundaries without retracting the error", async () => {
    const scope = { sourceId: 7201, customerId: 7201, customerName: "Updater fixture" };
    const installationId = randomUUID();
    const error = event({ installationId, occurredAt: "2026-11-05T15:59:00Z", appVersion: "1.1.44", eventName: "error_reported",
      properties: { module: "backend", message: "[InstallerUpdater] engine", errorCode: "SOFTWARE_UPDATE_FAILED" } });
    const verified = event({ installationId, occurredAt: "2026-11-05T16:05:00Z", appVersion: "1.1.45", eventName: "usage_session_summary",
      properties: { featureId: "software_update", action: "installation_verified", result: "success" } });
    await persistUsageBatch(scope, [error, verified]);
    const scoped = { from: "2026-11-05", to: "2026-11-05", environment: "test" as const, appVersion: "1.1.44", customerKey: "customer:7201" };
    const listing = await listUsageEvents({ filters: scoped, errorsOnly: true, page: 1 });
    expect(listing.total).toBe(1);
    expect(listing.items[0].softwareUpdate).toEqual({ status: "verified", occurredAt: new Date(verified.occurredAt).toISOString(), appVersion: "1.1.45", eventId: verified.eventId });
    expect(listing.items[0].event).toEqual({ ...error, occurredAt: new Date(error.occurredAt).toISOString() });
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ errors: 1, errorCustomers: 1 });
    await persistUsageBatch({ ...scope, sourceId: 7202, customerId: 7202 }, [error]);
    const unrelated = await listUsageEvents({ filters: { ...scoped, customerKey: "customer:7202" }, errorsOnly: true, page: 1 });
    expect(unrelated.items[0].softwareUpdate).toEqual({ status: "unconfirmed" });
  });

  it("retains out-of-order 2/0/1 facts, never regresses, and rejects a second ID for revision 2", async () => {
    const scope = { sourceId: 6001, customerId: 6001, customerName: "Revision Fixture" };
    const installationId = randomUUID(), collectionId = randomUUID();
    const first = event({ schemaVersion: 2, installationId, eventName: "collection_finished", properties: {
      featureId: "collection", collectionId, outcome: "failed", result: "failure", outcomeRevision: 0,
      stopReason: "storage_error", committedRows: 0, failedRows: 8, frameCount: 8, durationMs: 1000 } });
    const second = event({ ...first, eventId: randomUUID(), eventName: "collection_outcome_reconciled", properties: {
      ...first.properties, outcome: "partial", result: "failure", outcomeRevision: 1,
      supersedesEventId: first.eventId, committedRows: 3, failedRows: 5 } });
    const latest = event({ ...second, eventId: randomUUID(), properties: { ...second.properties,
      outcome: "saved", result: "success", outcomeRevision: 2, supersedesEventId: second.eventId,
      committedRows: 8, failedRows: 0 } });
    const identity = { sourceId: scope.sourceId, installationId, collectionId };
    const scoped = { ...filters, customerKey: "customer:6001" };
    await persistUsageBatch(scope, [latest]);
    expect(await getUsageCollectionOutcome(identity)).toMatchObject({ latestRevision: 2, missingRevisions: 2,
      missingPredecessors: 1, complete: false, event: latest });
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ uses: 0, successes: 0 });
    await persistUsageBatch(scope, [first]);
    expect(await getUsageCollectionOutcome(identity)).toMatchObject({ latestRevision: 2, missingRevisions: 1, complete: false });
    await persistUsageBatch(scope, [second]);
    expect(await getUsageCollectionOutcome(identity)).toMatchObject({ latestRevision: 2, missingRevisions: 0,
      missingPredecessors: 0, complete: true, event: latest });
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ uses: 1, successes: 1, failures: 0, collectionMs: 1000 });
    await Promise.all(Array.from({ length: 3 }, () => persistUsageBatch(scope, [first, second, latest])));
    expect(await rows("SELECT event_id FROM usage_events WHERE source_id=6001")).toHaveLength(3);
    await expect(persistUsageBatch(scope, [{ ...latest, eventId: randomUUID() }])).rejects.toMatchObject({ status: 409, code: "COLLECTION_REVISION_CONFLICT" });
    await expect(persistUsageBatch(scope, [{ ...latest, properties: { ...latest.properties, committedRows: 9 } }])).rejects.toMatchObject({ status: 409 });
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ uses: 1, successes: 1, failures: 0 });
    const reversed = event({ ...latest, eventId: randomUUID(), properties: { ...latest.properties, outcome: "failed",
      result: "failure", outcomeRevision: 3, supersedesEventId: latest.eventId, committedRows: 0, failedRows: 8 } });
    await persistUsageBatch(scope, [reversed]);
    await persistUsageBatch(scope, [latest]);
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ uses: 0, successes: 0, failures: 1 });
  });

  it("does not count saved-but-empty records or quality reports as confirmed usage", async () => {
    const scope = { sourceId: 6002, customerId: 6002, customerName: "Empty Fixture" };
    const empty = event({ schemaVersion: 2, eventName: "collection_finished", properties: { collectionId: randomUUID(),
      outcome: "saved", result: "success", outcomeRevision: 0, stopReason: "manual_stop", committedRows: 0, failedRows: 0, frameCount: 0 } });
    await persistUsageBatch(scope, [empty, event({ schemaVersion: 2, eventName: "usage_delivery_summary", properties: {
      qualityId: randomUUID(), queuedCount: 0, droppedCount: 0, invalidCount: 0 } })]);
    expect(await getUsageAnalysisSummary({ ...filters, customerKey: "customer:6002" })).toMatchObject({ usedCustomers: 0, uses: 0, successes: 0 });
  });

  it("keeps revision conflicts atomic and identities isolated, reporting mismatched predecessors", async () => {
    const scope = { sourceId: 6003, customerId: 6003, customerName: "Isolation Fixture" };
    const first = event({ schemaVersion: 2, eventName: "collection_finished", properties: { collectionId: "collection-1",
      outcome: "saved", result: "success", outcomeRevision: 0, stopReason: "manual_stop", committedRows: 1, failedRows: 0, frameCount: 1 } });
    await persistUsageBatch(scope, [first]);
    const fresh = event();
    await expect(persistUsageBatch(scope, [fresh, { ...first, eventId: randomUUID() }])).rejects.toMatchObject({ status: 409 });
    expect(await rows("SELECT event_id FROM usage_events WHERE event_id=?", [fresh.eventId])).toHaveLength(0);
    await persistUsageBatch({ ...scope, sourceId: 6004 }, [first]);
    await persistUsageBatch(scope, [{ ...first, installationId: randomUUID() }]);
    const mismatch = event({ ...first, eventId: randomUUID(), eventName: "collection_outcome_reconciled", properties: {
      ...first.properties, outcomeRevision: 1, supersedesEventId: randomUUID() } });
    await persistUsageBatch(scope, [mismatch]);
    expect(await getUsageCollectionOutcome({ sourceId: scope.sourceId, installationId: first.installationId, collectionId: "collection-1" }))
      .toMatchObject({ latestRevision: 1, missingRevisions: 0, missingPredecessors: 1, complete: false });
  });

  it("deduplicates concurrent retries and rejects changed bodies without overwriting", async () => {
    const payload = event();
    await Promise.all(Array.from({ length: 5 }, () => persistUsageBatch(principal, [payload])));
    expect((await rows("SELECT * FROM usage_events WHERE event_id=?", [payload.eventId]))).toHaveLength(1);
    await expect(persistUsageBatch(principal, [{ ...payload, properties: { result: "failure" } }])).rejects.toMatchObject({ status: 409 });
    expect(JSON.parse((await rows("SELECT payload_json FROM usage_events WHERE event_id=?", [payload.eventId]))[0].payload_json)).toEqual(payload);
  });
  it("uses full-scope business evidence and Beijing buckets for dashboard trends and rankings", async () => {
    const scope = { sourceId: 4901, customerId: 4901, customerName: "Dashboard Fixture" };
    const sample = event({ eventName: "monitoring_usage_summary", occurredAt: "2026-09-25T15:59:59Z",
      properties: { featureId: "monitoring", durationMs: 120000, systemType: "foot" } });
    await persistUsageBatch(scope, [sample, sample]);
    await persistUsageBatch(scope, [event({ eventName: "feature_exposed", occurredAt: "2026-09-25T16:00:00Z", properties: { featureId: "export" } }),
      event({ eventName: "error_reported", occurredAt: "2026-09-25T16:00:00Z", properties: { module: "export", message: "synthetic", count: 3 } })]);
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

  it("keeps Beijing midnight boundaries, versions and system filters aligned in every view", async () => {
    const scope = { sourceId: 581, customerId: 130, customerName: "Boundary" };
    const sample = (occurredAt: string, patch: Partial<UsageEvent> = {}) => event({ occurredAt,
      properties: { featureId: "export", result: "success", systemType: "hand" }, ...patch });
    const included = [sample("2026-10-05T16:00:00.000Z"), sample("2026-10-06T00:00:00.000Z"), sample("2026-10-06T15:59:59.999Z")];
    const error = sample("2026-10-06T01:00:00Z", { eventName: "error_reported", properties: { featureId: "export", systemType: "hand", count: 2 } });
    await persistUsageBatch(scope, [...included, error,
      sample("2026-10-05T15:59:59.999Z"), sample("2026-10-06T16:00:00.000Z"),
      sample("2026-10-06T12:00:00Z", { environment: "production" }),
      sample("2026-10-06T12:00:00Z", { appVersion: "other-version" }),
      sample("2026-10-06T12:00:00Z", { properties: { featureId: "export", result: "success", systemType: "car" } }),
    ]);
    const scoped = { ...filters, from: "2026-10-06", to: "2026-10-06", customerKey: "customer:130", appVersion: "1.2.3", systemType: "hand" };
    expect(await getUsageAnalysisSummary(scoped)).toMatchObject({ observedEvents: 4, successes: 3, errors: 2 });
    expect((await listUsageFeatureUsage({ filters: scoped, page: 1, sort: "usage", category: "business" })).items[0]).toMatchObject({ successes: 3, activeDays: 1 });
    expect((await listUsageCustomerUsage({ filters: scoped, page: 1, sort: "recent" })).items[0]).toMatchObject({ activeDays: 1, lastUsedMs: Date.parse(included[2].occurredAt) });
    expect((await listUsageSystems(scoped))[0]).toMatchObject({ events: 4, activeDays: 1 });
    const overview = await getUsageOverview(scoped);
    expect(overview.totals).toMatchObject({ events: 4, activeDays: 1 });
    expect(overview.days).toHaveLength(1);
    expect(overview.days[0]).toMatchObject({ day: Date.parse("2026-10-06") / 86400000, events: 4 });
    expect((await getUsageDashboard(scoped)).days).toEqual([{ day: Date.parse("2026-10-06") / 86400000, usedCustomers: 1, errors: 2, monitoringMs: 0 }]);
    const timeline = await listUsageEvents({ filters: scoped, errorsOnly: false, page: 1 });
    expect(timeline.total).toBe(4);
    expect(timeline.items[0].event.occurredAt).toBe(included[2].occurredAt);
    expect((await listUsageEvents({ filters: scoped, errorsOnly: true, page: 1 })).items.map(row => row.eventId)).toEqual([error.eventId]);
    expect((await getUsageEventContext({ sourceId: scope.sourceId, installationId: included[0].installationId, eventId: included[0].eventId }))?.[0].occurredAt).toBe(included[0].occurredAt);
    const nextDay = { ...scoped, from: "2026-10-07", to: "2026-10-07" };
    expect((await listUsageEvents({ filters: nextDay, errorsOnly: false, page: 1 })).total).toBe(1);
    expect((await listUsageCustomerUsage({ filters: { ...scoped, to: "2026-10-07" }, page: 1, sort: "recent" })).items[0].activeDays).toBe(2);
    expect((await listUsageCustomerUsage({ filters: { ...scoped, appVersion: "missing" }, page: 1, sort: "recent" })).items).toHaveLength(0);
  });
});
