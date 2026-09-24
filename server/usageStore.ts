import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { agentChatSources, customers, licenseKeys, usageEvents, usageSources } from "../drizzle/schema";
import { getDb } from "./db";
import { AgentSyncError, authenticateLicenseUpload } from "./agentSyncStore";
import { sanitizeUsageEvent, type UsageEvent, type UsageFilters } from "./usageSchema";

export type UsagePrincipal = { sourceId: number; customerId: number | null; customerName: string };

/** Obtain the configured database without accepting a write that cannot be persisted. */
async function database() {
  const db = await getDb();
  if (!db) throw new AgentSyncError(503, "STORAGE_UNAVAILABLE");
  return db;
}

/** Reuse license validation and obtain server-owned company metadata for the source snapshot. */
export async function authenticateUsage(key: string): Promise<UsagePrincipal> {
  const principal = await authenticateLicenseUpload(key);
  const db = await database();
  const [source] = await db.select({ customerId: licenseKeys.customerId, customerName: customers.name,
    licenseName: licenseKeys.customerName, licenseKeyId: licenseKeys.id,
  }).from(agentChatSources).innerJoin(licenseKeys, eq(agentChatSources.licenseKeyId, licenseKeys.id))
    .leftJoin(customers, eq(customers.id, licenseKeys.customerId)).where(eq(agentChatSources.id, principal.tenantId)).limit(1);
  if (!source) throw new AgentSyncError(401, "INVALID_LICENSE");
  return { sourceId: principal.tenantId, customerId: source.customerId,
    customerName: source.customerName || source.licenseName || `未绑定公司 · 密钥 #${source.licenseKeyId}` };
}

/** Hash canonical content without retaining credentials that appeared in raw error text. */
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** Atomically save all events; immutable receipts prevent retries or changed customer mappings from rewriting history. */
export async function persistUsageBatch(principal: UsagePrincipal, events: UsageEvent[], connection?: Awaited<ReturnType<typeof database>>) {
  const db = connection ?? await database();
  // Stable insertion order avoids deadlocks when overlapping batches arrive in different orders.
  const sorted = events.map(raw => ({ raw, event: sanitizeUsageEvent(raw) }))
    .sort((a, b) => `${a.event.installationId}:${a.event.eventId}`.localeCompare(`${b.event.installationId}:${b.event.eventId}`));
  await db.transaction(async tx => {
    await tx.insert(usageSources).values(principal).onDuplicateKeyUpdate({ set: { sourceId: sql`source_id` } });
    for (const { raw, event } of sorted) {
      const properties = event.properties;
      const payloadHash = digest({ ...raw, eventId: event.eventId, installationId: event.installationId,
        sessionId: event.sessionId, occurredAt: event.occurredAt });
      await tx.insert(usageEvents).values({
        sourceId: principal.sourceId, installationId: event.installationId, eventId: event.eventId,
        sessionId: event.sessionId, occurredMs: Date.parse(event.occurredAt),
        appVersion: event.appVersion, environment: event.environment, eventName: event.eventName,
        featureId: properties.featureId, module: properties.module, result: properties.result,
        durationMs: properties.durationMs === undefined ? undefined : Math.round(properties.durationMs),
        occurrenceCount: event.eventName === "error_reported" ? Math.max(1, properties.count ?? 1) : 1,
        errorFingerprint: event.eventName === "error_reported"
          ? digest([properties.module, properties.errorType, properties.errorCode, properties.message, properties.stack]) : null,
        payloadHash, payloadJson: JSON.stringify(event),
      }).onDuplicateKeyUpdate({ set: { eventId: sql`event_id` } });
      const [receipt] = await tx.select({ payloadHash: usageEvents.payloadHash }).from(usageEvents).where(and(
        eq(usageEvents.sourceId, principal.sourceId), eq(usageEvents.installationId, event.installationId),
        eq(usageEvents.eventId, event.eventId),
      )).for("update");
      if (!receipt || receipt.payloadHash !== payloadHash) throw new AgentSyncError(409, "EVENT_CONTENT_CONFLICT");
    }
  });
}

const customerKey = sql<string>`IF(${usageSources.customerId} IS NULL, CONCAT('source:', ${usageSources.sourceId}), CONCAT('customer:', ${usageSources.customerId}))`;
const receivedAt = sql`UNIX_TIMESTAMP(${usageEvents.receivedAt})`.mapWith(value => new Date(Number(value) * 1000));
const summaryColumns = {
  events: count(),
  installations: sql<number>`COUNT(DISTINCT CONCAT(${usageEvents.sourceId}, ':', ${usageEvents.installationId}))`.mapWith(Number),
  customers: sql<number>`COUNT(DISTINCT ${customerKey})`.mapWith(Number),
  activeDays: sql<number>`COUNT(DISTINCT FLOOR(${usageEvents.occurredMs} / 86400000))`.mapWith(Number),
  errors: sql<number>`COALESCE(SUM(IF(${usageEvents.eventName} = 'error_reported', ${usageEvents.occurrenceCount}, 0)), 0)`.mapWith(Number),
  uniqueErrors: sql<number>`COUNT(DISTINCT ${usageEvents.errorFingerprint})`.mapWith(Number),
};

/** Construct bounded UTC event-time filters; company identity comes only from its immutable snapshot. */
function whereFilters(filters: UsageFilters): SQL | undefined {
  const conditions = [gte(usageEvents.occurredMs, Date.parse(filters.from)), lt(usageEvents.occurredMs, Date.parse(filters.to) + 86400000)];
  if (filters.environment !== "all") conditions.push(eq(usageEvents.environment, filters.environment));
  if (filters.customerKey) conditions.push(eq(customerKey, filters.customerKey));
  if (filters.appVersion) conditions.push(eq(usageEvents.appVersion, filters.appVersion));
  if (filters.module) conditions.push(eq(usageEvents.module, filters.module));
  if (filters.featureId) conditions.push(eq(usageEvents.featureId, filters.featureId));
  return and(...conditions);
}

/** List observed customer identities, including sources without a company binding. */
export async function listUsageCustomers() {
  const db = await database();
  return db.select({ customerKey, customerName: sql<string>`MAX(${usageSources.customerName})` }).from(usageSources)
    .groupBy(customerKey).orderBy(asc(customerKey));
}

/** Aggregate all matching events in SQL; displayed top lists state their explicit cap. */
export async function getUsageOverview(filters: UsageFilters) {
  const db = await database(), where = whereFilters(filters);
  const totals = await db.select(summaryColumns).from(usageEvents)
    .innerJoin(usageSources, eq(usageSources.sourceId, usageEvents.sourceId)).where(where);
  const features = await db.select({ eventName: usageEvents.eventName, featureId: usageEvents.featureId,
    ...summaryColumns, successes: sql<number>`SUM(IF(${usageEvents.result} = 'success', 1, 0))`.mapWith(Number),
    failures: sql<number>`SUM(IF(${usageEvents.result} = 'failure', 1, 0))`.mapWith(Number),
    durationMs: sql<number>`COALESCE(SUM(${usageEvents.durationMs}), 0)`.mapWith(Number),
  }).from(usageEvents).innerJoin(usageSources, eq(usageSources.sourceId, usageEvents.sourceId)).where(where)
    .groupBy(usageEvents.eventName, usageEvents.featureId).orderBy(desc(count())).limit(100);
  const customerRows = await db.select({ customerKey, customerName: sql<string>`MAX(${usageSources.customerName})`,
    ...summaryColumns, lastOccurredMs: sql<number>`MAX(${usageEvents.occurredMs})`.mapWith(Number),
    monitoringMs: sql<number>`COALESCE(SUM(IF(${usageEvents.eventName} = 'monitoring_usage_summary', ${usageEvents.durationMs}, 0)), 0)`.mapWith(Number),
    collectionMs: sql<number>`COALESCE(SUM(IF(${usageEvents.eventName} = 'collection_finished', ${usageEvents.durationMs}, 0)), 0)`.mapWith(Number),
    foregroundMs: sql<number>`COALESCE(SUM(IF(${usageEvents.eventName} = 'usage_session_summary' AND ${usageEvents.featureId} = 'foreground', ${usageEvents.durationMs}, 0)), 0)`.mapWith(Number),
    interactionMs: sql<number>`COALESCE(SUM(IF(${usageEvents.eventName} = 'usage_session_summary' AND ${usageEvents.featureId} = 'interaction', ${usageEvents.durationMs}, 0)), 0)`.mapWith(Number),
  }).from(usageEvents).innerJoin(usageSources, eq(usageSources.sourceId, usageEvents.sourceId)).where(where)
    .groupBy(customerKey).orderBy(desc(count())).limit(100);
  const days = await db.select({ day: sql<number>`FLOOR(${usageEvents.occurredMs} / 86400000)`.mapWith(Number), ...summaryColumns })
    .from(usageEvents).innerJoin(usageSources, eq(usageSources.sourceId, usageEvents.sourceId)).where(where)
    .groupBy(sql`FLOOR(${usageEvents.occurredMs} / 86400000)`).orderBy(asc(sql`FLOOR(${usageEvents.occurredMs} / 86400000)`));
  const systemType = sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${usageEvents.payloadJson}, '$.properties.systemType'))`;
  const systems = await db.select({ systemType, ...summaryColumns,
    entries: sql<number>`SUM(IF(${usageEvents.eventName} = 'system_entered', 1, 0))`.mapWith(Number),
    monitoringMs: sql<number>`COALESCE(SUM(IF(${usageEvents.eventName} = 'monitoring_usage_summary', ${usageEvents.durationMs}, 0)), 0)`.mapWith(Number),
  }).from(usageEvents).innerJoin(usageSources, eq(usageSources.sourceId, usageEvents.sourceId))
    .where(and(where, sql`${systemType} IS NOT NULL AND ${systemType} <> 'unknown'`))
    .groupBy(systemType).orderBy(desc(count())).limit(100);
  return { totals: totals[0], features, customers: customerRows, systems, days, listLimit: 100 };
}

const eventColumns = { sourceId: usageEvents.sourceId, installationId: usageEvents.installationId, eventId: usageEvents.eventId,
  customerName: usageSources.customerName, payloadJson: usageEvents.payloadJson, receivedAt };

/** Read one bounded timeline page, optionally restricted to reported errors. */
export async function listUsageEvents(input: { filters: UsageFilters; errorsOnly: boolean; page: number }) {
  const db = await database();
  const where = and(whereFilters(input.filters), input.errorsOnly ? eq(usageEvents.eventName, "error_reported") : undefined);
  const [{ total }] = await db.select({ total: count() }).from(usageEvents)
    .innerJoin(usageSources, eq(usageSources.sourceId, usageEvents.sourceId)).where(where);
  const pageSize = 50, page = Math.min(input.page, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await db.select(eventColumns).from(usageEvents).innerJoin(usageSources, eq(usageSources.sourceId, usageEvents.sourceId))
    .where(where).orderBy(desc(usageEvents.occurredMs), asc(usageEvents.sourceId), asc(usageEvents.installationId), asc(usageEvents.eventId))
    .limit(pageSize).offset((page - 1) * pageSize);
  return { items: rows.map(({ payloadJson, ...row }) => ({ ...row, event: JSON.parse(payloadJson) as UsageEvent })), total, page, pageSize };
}

/** Retrieve preceding events within the selected source, installation and session for error investigation. */
export async function getUsageEventContext(input: { sourceId: number; installationId: string; eventId: string }) {
  const db = await database();
  const identity = and(eq(usageEvents.sourceId, input.sourceId), eq(usageEvents.installationId, input.installationId.toLowerCase()));
  const [target] = await db.select().from(usageEvents).where(and(identity, eq(usageEvents.eventId, input.eventId.toLowerCase()))).limit(1);
  if (!target) return null;
  const rows = await db.select({ payloadJson: usageEvents.payloadJson }).from(usageEvents)
    .where(and(identity, eq(usageEvents.sessionId, target.sessionId), lte(usageEvents.occurredMs, target.occurredMs)))
    .orderBy(desc(usageEvents.occurredMs), desc(usageEvents.eventId)).limit(20);
  return rows.reverse().map(row => JSON.parse(row.payloadJson) as UsageEvent);
}
