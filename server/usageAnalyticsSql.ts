import { sql, type SQL } from "drizzle-orm";
import { usageEvents, usageSources } from "../drizzle/schema";

const fallbackFeatures: Record<string, string> = {
  app_session_started: "application", system_entered: "system_navigation",
  monitoring_usage_summary: "monitoring", collection_started: "collection", collection_finished: "collection",
  collection_outcome_reconciled: "collection", usage_delivery_summary: "usage_delivery",
  export_result: "export", playback_started: "playback", device_connection_result: "connection",
  algorithm_result: "algorithms", custom_system_saved: "workspace", agent_task_result: "agent",
};

/** Legacy domain events without a feature ID keep the same identity in lists and drill-down filters. */
export const usageFeatureId = sql<string>`COALESCE(NULLIF(${usageEvents.featureId}, ''), CASE ${usageEvents.eventName}
  ${sql.join(Object.entries(fallbackFeatures).map(([event, feature]) => sql`WHEN ${event} THEN ${feature}`), sql` `)} END)`;
export const usageCustomerKey = sql<string>`IF(${usageSources.customerId} IS NULL,
  CONCAT('source:', ${usageSources.sourceId}), CONCAT('customer:', ${usageSources.customerId}))`;
export const usageSystemType = sql<string>`NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${usageEvents.payloadJson}, '$.properties.systemType')), 'unknown'), 'null')`;
const diagnosticFeatures = ["application", "foreground", "background", "interaction", "renderer_long_task",
  "main_event_loop", "main_memory", "sensor_frame_gap", "sensor_frames", "sensor_first_frame", "sensor_stream_gap", "usage_delivery"];
export const usageFeatureCategory = sql<"business" | "diagnostic">`IF(${usageFeatureId} IN
  (${sql.join(diagnosticFeatures.map(value => sql`${value}`), sql`, `)}), 'diagnostic', 'business')`;
const resultEvents = ["device_connection_result", "export_result", "algorithm_result",
  "analysis_tool_used", "custom_system_saved", "agent_task_result"];
const isV2 = sql`JSON_EXTRACT(${usageEvents.payloadJson}, '$.schemaVersion') = 2`;
const collectionId = sql`JSON_UNQUOTE(JSON_EXTRACT(${usageEvents.payloadJson}, '$.properties.collectionId'))`;
// ⚠️ Missing or mismatched predecessors keep an outcome unconfirmed; a delayed old revision cannot restore success.
export const usageLatestCollectionOutcome = sql`(${usageEvents.eventName} IN ('collection_finished', 'collection_outcome_reconciled') AND (
  NOT (${isV2}) OR EXISTS (SELECT 1 FROM usage_collection_revisions current_revision
    WHERE current_revision.source_id = ${usageEvents.sourceId} AND current_revision.installation_id = ${usageEvents.installationId}
      AND current_revision.collection_id = ${collectionId} AND current_revision.event_id = ${usageEvents.eventId}
      AND NOT EXISTS (SELECT 1 FROM usage_collection_revisions newer
        WHERE newer.source_id = current_revision.source_id AND newer.installation_id = current_revision.installation_id
          AND newer.collection_id = current_revision.collection_id AND newer.revision > current_revision.revision)
      AND NOT EXISTS (SELECT 1 FROM usage_collection_revisions chain
        WHERE chain.source_id = current_revision.source_id AND chain.installation_id = current_revision.installation_id
          AND chain.collection_id = current_revision.collection_id AND chain.revision > 0
          AND NOT EXISTS (SELECT 1 FROM usage_collection_revisions previous
            WHERE previous.source_id = chain.source_id AND previous.installation_id = chain.installation_id
              AND previous.collection_id = chain.collection_id AND previous.revision = chain.revision - 1
              AND previous.event_id = chain.supersedes_event_id))
  )))`;
const hasResultEvent = sql`(${usageEvents.eventName} IN (${sql.join(resultEvents.map(value => sql`${value}`), sql`, `)}) OR ${usageLatestCollectionOutcome})`;
const nonemptyCollection = sql`(NOT (${isV2}) OR NOT (${usageLatestCollectionOutcome})
  OR JSON_EXTRACT(${usageEvents.payloadJson}, '$.properties.committedRows') > 0)`;
export const usageSuccessfulResult = sql`(${hasResultEvent} AND ${usageEvents.result} = 'success' AND ${nonemptyCollection})`;

// Attempts, exposure, failures and runtime samples are not evidence of successful product use.
export const usageBusinessActivity = sql`(${usageFeatureCategory} = 'business' AND (
  (${usageEvents.eventName} = 'monitoring_usage_summary' AND ${usageEvents.durationMs} > 0)
  OR (${usageSuccessfulResult})
  OR (${usageEvents.eventName} IN ('playback_started', 'analysis_tool_used', 'custom_system_saved')
    AND ${usageEvents.result} IS NULL)
  OR (${usageEvents.eventName} = 'playback_started' AND ${usageEvents.result} = 'success')
))`;
const operationKey = sql`CONCAT(${usageEvents.sourceId}, ':', ${usageEvents.installationId}, ':',
  COALESCE(${usageFeatureId}, ''), ':', COALESCE(CASE WHEN ${isV2} AND ${usageEvents.eventName} IN
    ('collection_started', 'collection_finished', 'collection_outcome_reconciled') THEN ${collectionId} END,
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${usageEvents.payloadJson}, '$.properties.operationId')), 'null'), ${usageEvents.eventId}))`;
const number = (expression: SQL) => sql<number>`${expression}`.mapWith(Number);
const distinctOperations = (condition: SQL) => number(sql`COUNT(DISTINCT CASE WHEN ${condition} THEN ${operationKey} END)`);
const identities = (condition: SQL) => number(sql`COUNT(DISTINCT CASE WHEN ${condition} THEN ${usageCustomerKey} END)`);
const duration = (event: string) => number(sql`COALESCE(SUM(IF(${usageEvents.eventName} = ${event}, ${usageEvents.durationMs}, 0)), 0)`);
const durationSamples = (event: string) => number(sql`COUNT(CASE WHEN ${usageEvents.eventName} = ${event} AND ${usageEvents.durationMs} IS NOT NULL THEN 1 END)`);

export const usageAnalysisColumns = {
  observedCustomers: number(sql`COUNT(DISTINCT ${usageCustomerKey})`),
  usedCustomers: identities(usageBusinessActivity),
  errorCustomers: identities(sql`${usageEvents.eventName} = 'error_reported'`),
  installations: number(sql`COUNT(DISTINCT CONCAT(${usageEvents.sourceId}, ':', ${usageEvents.installationId}))`),
  observedEvents: number(sql`COUNT(*)`),
  exposures: number(sql`COALESCE(SUM(IF(${usageEvents.eventName} = 'feature_exposed', 1, 0)), 0)`),
  attempts: distinctOperations(sql`${usageEvents.eventName} = 'feature_attempted'`),
  entries: distinctOperations(sql`${usageEvents.eventName} = 'system_entered'`),
  uses: distinctOperations(usageBusinessActivity),
  successes: distinctOperations(usageSuccessfulResult),
  failures: distinctOperations(sql`${hasResultEvent} AND ${usageEvents.result} = 'failure'`),
  cancelled: distinctOperations(sql`${hasResultEvent} AND ${usageEvents.result} = 'cancelled'`),
  unknownResults: distinctOperations(sql`${hasResultEvent} AND (${usageEvents.result} IS NULL OR ${usageEvents.result} = 'unknown')`),
  errors: number(sql`COALESCE(SUM(IF(${usageEvents.eventName} = 'error_reported', ${usageEvents.occurrenceCount}, 0)), 0)`),
  activeDays: number(sql`COUNT(DISTINCT CASE WHEN ${usageBusinessActivity} THEN FLOOR(${usageEvents.occurredMs} / 86400000) END)`),
  monitoringMs: duration("monitoring_usage_summary"), monitoringSamples: durationSamples("monitoring_usage_summary"),
  collectionMs: number(sql`COALESCE(SUM(IF(${usageLatestCollectionOutcome}, ${usageEvents.durationMs}, 0)), 0)`),
  collectionSamples: number(sql`COUNT(CASE WHEN ${usageLatestCollectionOutcome} AND ${usageEvents.durationMs} IS NOT NULL THEN 1 END)`),
  lastUsedMs: sql<number | null>`MAX(CASE WHEN ${usageBusinessActivity} THEN ${usageEvents.occurredMs} END)`.mapWith(Number),
  lastObservedMs: sql<number>`MAX(${usageEvents.occurredMs})`.mapWith(Number),
  lastReceivedMs: sql<number>`MAX(UNIX_TIMESTAMP(${usageEvents.receivedAt}) * 1000)`.mapWith(Number),
};
