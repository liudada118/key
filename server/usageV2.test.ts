import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { usageBatchSchema, usageEventSchema } from "./usageSchema";

/** Construct a complete revision-zero outcome without customer data. */
function outcome(properties: Record<string, unknown> = {}) {
  return { schemaVersion: 2, eventId: randomUUID(), installationId: randomUUID(), sessionId: randomUUID(),
    occurredAt: "2026-10-29T00:00:00Z", appVersion: "1.1.37", environment: "test", eventName: "collection_finished",
    properties: { collectionId: randomUUID(), outcome: "saved", result: "success", outcomeRevision: 0,
      stopReason: "manual_stop", committedRows: 1, failedRows: 0, frameCount: 1, ...properties } };
}

describe("usage v2 strict receiver contract", () => {
  it("keeps v1 unchanged and requires homogeneous batch versions", () => {
    const v2 = outcome();
    const v1 = { ...v2, schemaVersion: 1, properties: { result: "success" } };
    expect(usageBatchSchema.safeParse({ schemaVersion: 1, events: [v1] }).success).toBe(true);
    expect(usageBatchSchema.safeParse({ schemaVersion: 2, events: [v2] }).success).toBe(true);
    for (const batch of [{ schemaVersion: 1, events: [v2] }, { schemaVersion: 2, events: [v1, v2] },
      { schemaVersion: 1, events: [{ ...v2, schemaVersion: 1 }] }]) {
      expect(usageBatchSchema.safeParse(batch).success).toBe(false);
    }
  });

  it("requires collection identity, typed terminal counts, matching results and revision links", () => {
    for (const properties of [{ collectionId: undefined }, { collectionId: "private path" }, { stopReason: undefined },
      { outcome: undefined }, { outcome: "partial", result: "success" }, { result: undefined },
      { outcomeRevision: 1 }, { supersedesEventId: randomUUID() }, { committedRows: undefined },
      { failedRows: -1 }, { frameCount: 1.5 }, { committedRows: 1e12 + 1 }, { durationMs: 86400001 },
      { collectionId: "x".repeat(81) }, { filePath: "private.csv" }]) {
      expect(usageEventSchema.safeParse(outcome(properties)).success).toBe(false);
    }
    const first = outcome();
    const revision = { ...outcome({ outcomeRevision: 2, supersedesEventId: first.eventId }), eventName: "collection_outcome_reconciled" };
    expect(usageEventSchema.safeParse(revision).success).toBe(true);
    expect(usageEventSchema.safeParse({ ...revision, properties: { ...revision.properties, supersedesEventId: revision.eventId } }).success).toBe(false);
    expect(usageEventSchema.safeParse({ ...first, eventName: "collection_started", properties: { collectionId: first.properties.collectionId } }).success).toBe(true);
    expect(usageEventSchema.safeParse({ ...first, eventName: "collection_started", properties: {} }).success).toBe(false);
  });

  it("accepts quality counters and known summary kinds, rejects unsafe and unbounded metadata", () => {
    const quality = { ...outcome(), eventName: "usage_delivery_summary", properties: { qualityId: randomUUID(),
      queuedCount: 0, droppedCount: 0, invalidCount: 0, expiredCount: 0, capacityDroppedCount: 0,
      storageFailureCount: 0, suppressedCount: 0, repeatedCount: 0, usageContext: "customer", oldestQueuedAt: "2026-10-29T00:00:00Z" } };
    expect(usageEventSchema.safeParse(quality).success).toBe(true);
    for (const patch of [{ qualityId: undefined }, { queuedCount: undefined }, { invalidCount: "0" },
      { droppedCount: -1 }, { suppressedCount: 1.1 }, { repeatedCount: 1e12 + 1 }, { usageContext: "private" },
      { oldestQueuedAt: "yesterday" }, { summaryKind: "effective_duration" }, { key: "secret" }]) {
      expect(usageEventSchema.safeParse({ ...quality, properties: { ...quality.properties, ...patch } }).success).toBe(false);
    }
    expect(usageEventSchema.safeParse({ ...quality, schemaVersion: 1 }).success).toBe(false);
    expect(usageEventSchema.safeParse({ ...quality, eventName: "error_reported", properties: { stack: "错".repeat(1800) } }).success).toBe(false);
    for (const summaryKind of ["page_residence", "legacy_frame_window"]) {
      expect(usageEventSchema.safeParse({ ...quality, eventName: "usage_session_summary", properties: { summaryKind } }).success).toBe(true);
    }
  });
});
