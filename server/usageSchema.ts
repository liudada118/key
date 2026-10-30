import { z } from "zod";

export const MAX_USAGE_BATCH_BYTES = 256 * 1024;
export const MAX_USAGE_EVENT_BYTES = 4 * 1024;
export const usageEventNames = [
  "app_session_started", "feature_exposed", "feature_attempted", "system_entered",
  "device_connection_result", "monitoring_usage_summary", "collection_started", "collection_finished",
  "export_result", "playback_started", "algorithm_result", "analysis_tool_used", "custom_system_saved",
  "agent_task_result", "usage_session_summary", "error_reported",
] as const;
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
const runtimeVersions = z.object({
  frontendReleaseId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  frontendBuildId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  hostContract: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  systemPackageVersion: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/).optional(),
  serverContractVersion: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/).optional(),
}).strict();
const propertiesSchema = z.object({
  featureId: identifier.optional(), systemType: identifier.optional(),
  systemOrigin: z.enum(["builtin", "copy", "custom"]).optional(), operationId: identifier.optional(),
  result: z.enum(["success", "failure", "cancelled", "unknown"]).optional(),
  durationMs: z.number().finite().min(0).max(86400000).optional(),
  count: z.number().int().min(0).max(1e12).optional(), format: z.literal("csv").optional(),
  errorCode: identifier.optional(), connectionType: z.enum(["serial", "halow", "unknown"]).optional(),
  mode: z.enum(["realtime", "playback"]).optional(), algorithmId: identifier.optional(),
  module: identifier.optional(), action: identifier.optional(), errorType: identifier.optional(),
  severity: z.enum(["warning", "error", "fatal"]).optional(),
  message: z.string().max(400).optional(), stack: z.string().max(1800).optional(),
}).strict();

const eventSchemaV1 = z.object({
  schemaVersion: z.literal(1), eventId: z.string().uuid(), installationId: z.string().uuid(),
  sessionId: z.string().uuid(), occurredAt: z.string().datetime({ offset: true }),
  appVersion: z.string().min(1).max(80), environment: z.enum(["production", "development", "test"]),
  eventName: z.enum(usageEventNames), properties: propertiesSchema, runtimeVersions: runtimeVersions.optional(),
}).strict();
const counter = z.number().int().min(0).max(1e12);
const propertiesSchemaV2 = propertiesSchema.extend({
  collectionId: identifier.optional(), outcome: z.enum(["saved", "partial", "failed", "cancelled", "unknown"]).optional(),
  stopReason: identifier.optional(), outcomeRevision: z.number().int().min(0).max(1e9).optional(),
  supersedesEventId: z.string().uuid().optional(), committedRows: counter.optional(), failedRows: counter.optional(),
  frameCount: counter.optional(), queuedCount: counter.optional(), droppedCount: counter.optional(),
  invalidCount: counter.optional(), expiredCount: counter.optional(), capacityDroppedCount: counter.optional(),
  storageFailureCount: counter.optional(), suppressedCount: counter.optional(), repeatedCount: counter.optional(),
  oldestQueuedAt: z.string().datetime({ offset: true }).optional(), qualityId: z.string().uuid().optional(),
  usageContext: z.enum(["customer", "internal", "demo", "test"]).optional(),
  summaryKind: z.enum(["page_residence", "legacy_frame_window"]).optional(),
}).strict();
const eventSchemaV2 = eventSchemaV1.extend({ schemaVersion: z.literal(2),
  eventName: z.enum([...usageEventNames, "usage_delivery_summary", "collection_outcome_reconciled"]),
  properties: propertiesSchemaV2,
}).strict();

/** Enforce the same text and byte limits for both immutable wire contracts. */
function validateEnvelope(event: z.infer<typeof eventSchemaV1> | z.infer<typeof eventSchemaV2>, ctx: z.RefinementCtx) {
  if (event.eventName !== "error_reported" && (event.properties.message !== undefined || event.properties.stack !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Error text requires error_reported" });
  }
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_USAGE_EVENT_BYTES) {
    ctx.addIssue({ code: "custom", message: "Event exceeds byte limit" });
  }
}
export const usageEventSchemaV1 = eventSchemaV1.superRefine(validateEnvelope);
export const usageEventSchemaV2 = eventSchemaV2.superRefine((event, ctx) => {
  validateEnvelope(event, ctx);
  const p = event.properties;
  const terminal = event.eventName === "collection_finished" || event.eventName === "collection_outcome_reconciled";
  if ((terminal || event.eventName === "collection_started") && !p.collectionId) {
    ctx.addIssue({ code: "custom", message: "Collection identity required" });
  }
  if (terminal) {
    const expected = { saved: "success", partial: "failure", failed: "failure", cancelled: "cancelled", unknown: "unknown" } as const;
    if (!p.outcome || p.result !== expected[p.outcome] || !p.stopReason || p.outcomeRevision === undefined
      || p.committedRows === undefined || p.failedRows === undefined || p.frameCount === undefined) {
      ctx.addIssue({ code: "custom", message: "Complete typed outcome required" });
    }
    if (event.eventName === "collection_finished" ? p.outcomeRevision !== 0 || p.supersedesEventId !== undefined
      : !p.outcomeRevision || !p.supersedesEventId || p.supersedesEventId.toLowerCase() === event.eventId.toLowerCase()) {
      ctx.addIssue({ code: "custom", message: "Invalid outcome revision" });
    }
  } else if (p.outcome !== undefined || p.outcomeRevision !== undefined || p.supersedesEventId !== undefined) {
    ctx.addIssue({ code: "custom", message: "Outcome revision requires a terminal collection event" });
  }
  if (event.eventName === "usage_delivery_summary" && (!p.qualityId || p.queuedCount === undefined
    || p.droppedCount === undefined || p.invalidCount === undefined)) {
    ctx.addIssue({ code: "custom", message: "Delivery counters and identity required" });
  }
});
export const usageEventSchema = z.discriminatedUnion("schemaVersion", [usageEventSchemaV1, usageEventSchemaV2]);

export const usageBatchSchema = z.discriminatedUnion("schemaVersion", [
  z.object({ schemaVersion: z.literal(1), events: z.array(usageEventSchemaV1).min(1).max(50) }).strict(),
  z.object({ schemaVersion: z.literal(2), events: z.array(usageEventSchemaV2).min(1).max(50) }).strict(),
]);
export type UsageEvent = z.infer<typeof usageEventSchema>;

/** Remove credentials and personal paths before storing or displaying error text. */
export function scrubUsageText(value: string) {
  return value
    .replace(/\b(?:Bearer|License)\s+[A-Za-z0-9_.+/=-]+/gi, "[credential]")
    .replace(/\b(?:api[_-]?key|token|password|secret|authorization|license[_-]?key)["']?\s*[=:]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;"'}\]]+)/gi, "[credential]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|[a-f0-9]{32,})\b/gi, "[credential]")
    .replace(/https?:\/\/[^\s<>'"]+/gi, "[url]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n"<>|]*/g, "[path]")
    .replace(/(?:\/(?:Users|home|tmp|var|opt|usr|app|workspace|mnt)\/|\\\\)[^\s"<>]*/g, "[path]");
}

/** Canonicalize IDs and error text so equivalent retries retain one payload digest. */
export function sanitizeUsageEvent(event: UsageEvent): UsageEvent {
  return {
    ...event, eventId: event.eventId.toLowerCase(), installationId: event.installationId.toLowerCase(),
    sessionId: event.sessionId.toLowerCase(), occurredAt: new Date(event.occurredAt).toISOString(),
    properties: { ...event.properties,
      ...(event.schemaVersion === 2 && event.properties.supersedesEventId
        ? { supersedesEventId: event.properties.supersedesEventId.toLowerCase() } : {}),
      ...(event.properties.message !== undefined ? { message: scrubUsageText(event.properties.message) } : {}),
      ...(event.properties.stack !== undefined ? { stack: scrubUsageText(event.properties.stack) } : {}),
    },
  };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Invalid date");
export const usageFiltersSchema = z.object({
  from: date, to: date, environment: z.enum(["production", "development", "test", "all"]).default("production"),
  customerKey: z.string().regex(/^(customer|source):[1-9]\d*$/).optional(),
  appVersion: z.string().max(80).optional(), module: identifier.optional(),
  featureId: identifier.optional(),
  identityScope: z.enum(["all", "company", "unbound"]).optional(),
  systemType: identifier.optional(),
}).strict().refine(value => Date.parse(value.to) >= Date.parse(value.from)
  && Date.parse(value.to) - Date.parse(value.from) < 93 * 86400000, "Select up to 93 days");
export type UsageFilters = z.infer<typeof usageFiltersSchema>;
