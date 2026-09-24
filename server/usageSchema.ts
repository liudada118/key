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

export const usageEventSchema = z.object({
  schemaVersion: z.literal(1), eventId: z.string().uuid(), installationId: z.string().uuid(),
  sessionId: z.string().uuid(), occurredAt: z.string().datetime({ offset: true }),
  appVersion: z.string().min(1).max(80), environment: z.enum(["production", "development", "test"]),
  eventName: z.enum(usageEventNames), properties: propertiesSchema,
}).strict().superRefine((event, ctx) => {
  if (event.eventName !== "error_reported" && (event.properties.message !== undefined || event.properties.stack !== undefined)) {
    ctx.addIssue({ code: "custom", message: "Error text requires error_reported" });
  }
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_USAGE_EVENT_BYTES) {
    ctx.addIssue({ code: "custom", message: "Event exceeds byte limit" });
  }
});

export const usageBatchSchema = z.object({
  schemaVersion: z.literal(1), events: z.array(usageEventSchema).min(1).max(50),
}).strict();
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
}).strict().refine(value => Date.parse(value.to) >= Date.parse(value.from)
  && Date.parse(value.to) - Date.parse(value.from) < 93 * 86400000, "Select up to 93 days");
export type UsageFilters = z.infer<typeof usageFiltersSchema>;
