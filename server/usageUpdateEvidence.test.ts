import { describe, expect, it } from "vitest";
import { laterInstallationEvidence, type UsageEventIdentity } from "./usageUpdateEvidence";

const target: UsageEventIdentity = { sourceId: 1, installationId: "install-a", event: { schemaVersion: 1, eventId: "error",
  installationId: "install-a", sessionId: "before", occurredAt: "2026-11-04T09:19:39Z", appVersion: "1.1.44", environment: "production",
  eventName: "error_reported", properties: { errorCode: "SOFTWARE_UPDATE_FAILED", message: "[InstallerUpdater] engine" } } };
const success: UsageEventIdentity = { ...target, event: { ...target.event, eventId: "success", sessionId: "after", occurredAt: "2026-11-04T09:33:34Z",
  appVersion: "1.1.45", eventName: "usage_session_summary", properties: { featureId: "software_update", action: "installation_verified", result: "success" } } };
describe("later installer evidence", () => {
  it("recognizes explicit new-version startup in a later session", () => {
    expect(laterInstallationEvidence(target, [success])).toMatchObject({ status: "verified", appVersion: "1.1.45" });
  });
  it.each(["download_ready", "installer_handoff", "check_current", "update_available"])("does not call %s a confirmed installation", action => {
    expect(laterInstallationEvidence(target, [{ ...success, event: { ...success.event, properties: { ...success.event.properties, action } } }])).toEqual({ status: "unconfirmed" });
  });
  it("never uses another license, installation, environment, old result or distant update", () => {
    for (const candidate of [{ ...success, sourceId: 2 }, { ...success, installationId: "install-b" },
      { ...success, event: { ...success.event, environment: "test" as const } },
      { ...success, event: { ...success.event, occurredAt: "2026-11-04T08:00:00Z" } },
      { ...success, event: { ...success.event, occurredAt: "2026-11-06T08:00:00Z" } }]) {
      expect(laterInstallationEvidence(target, [candidate])).toEqual({ status: "unconfirmed" });
    }
    expect(laterInstallationEvidence({ ...target, event: { ...target.event, properties: { errorCode: "OTHER_ERROR" } } }, [success])).toBeNull();
  });
});
