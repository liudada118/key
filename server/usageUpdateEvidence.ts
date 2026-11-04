import type { UsageEvent } from "./usageSchema";

export type UsageEventIdentity = { sourceId: number; installationId: string; event: UsageEvent };
export const UPDATE_EVIDENCE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isSoftwareUpdateError(event: UsageEvent) {
  return event.eventName === "error_reported" && (event.properties.featureId === "software_update"
    || event.properties.errorCode === "SOFTWARE_UPDATE_FAILED"
    || event.properties.message?.startsWith("[InstallerUpdater]") === true);
}

/** Later success is evidence, not a retraction of an earlier error or proof of a shared operation. */
export function laterInstallationEvidence(target: UsageEventIdentity, candidates: UsageEventIdentity[]) {
  if (!isSoftwareUpdateError(target.event)) return null;
  const start = Date.parse(target.event.occurredAt);
  const verified = candidates.filter(item => item.sourceId === target.sourceId && item.installationId === target.installationId
    && item.event.environment === target.event.environment
    && item.event.eventName === "usage_session_summary" && item.event.properties.featureId === "software_update"
    && item.event.properties.action === "installation_verified" && item.event.properties.result === "success"
    && Date.parse(item.event.occurredAt) > start && Date.parse(item.event.occurredAt) <= start + UPDATE_EVIDENCE_WINDOW_MS)
    .sort((a, b) => Date.parse(a.event.occurredAt) - Date.parse(b.event.occurredAt))[0];
  return verified ? { status: "verified" as const, occurredAt: verified.event.occurredAt,
    appVersion: verified.event.appVersion, eventId: verified.event.eventId }
    : { status: "unconfirmed" as const };
}
