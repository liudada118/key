import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sanitizeUsageEvent, usageEventSchema } from "./usageSchema";

/** Construct a minimal old client event to test optional version compatibility. */
function event() {
  return { schemaVersion: 1, eventId: randomUUID(), installationId: randomUUID(), sessionId: randomUUID(),
    occurredAt: new Date().toISOString(), appVersion: "1.1.37", environment: "test", eventName: "feature_exposed", properties: {} };
}
describe("usage optional runtime version snapshot", () => {
  it("accepts old clients and preserves a whitelisted version combination", () => {
    expect(usageEventSchema.safeParse(event()).success).toBe(true);
    const versions = { frontendReleaseId: 1792370000000, frontendBuildId: 5, hostContract: 1,
      systemPackageVersion: "42", serverContractVersion: "policy-v1" };
    const parsed = usageEventSchema.parse({ ...event(), runtimeVersions: versions });
    expect(sanitizeUsageEvent(parsed).runtimeVersions).toEqual(versions);
  });
  it("rejects arbitrary metadata, invalid versions and unsafe counters", () => {
    for (const runtimeVersions of [{ secret: "no" }, { frontendBuildId: -1 }, { frontendReleaseId: Number.MAX_SAFE_INTEGER + 1 },
      { hostContract: 1.1 }, { systemPackageVersion: "x".repeat(81) }, { serverContractVersion: "https://example.com" }]) {
      expect(usageEventSchema.safeParse({ ...event(), runtimeVersions }).success).toBe(false);
    }
  });
});
