import { describe, expect, it } from "vitest";
import { decideDeviceAccess } from "./licenseDevices";

describe("license device policy", () => {
  const first = "a".repeat(64), second = "b".repeat(64);
  it("preserves unlimited licenses and requires an identity only for limited keys", () => {
    expect(decideDeviceAccess(0, undefined, []).allowed).toBe(true);
    expect(decideDeviceAccess(1, undefined, []).code).toBe("DEVICE_ID_REQUIRED");
  });
  it("does not consume another slot for the same computer", () => {
    expect(decideDeviceAccess(1, first, [{ deviceId: first, status: "active" }]).allowed).toBe(true);
    expect(decideDeviceAccess(1, second, [{ deviceId: first, status: "active" }]).code).toBe("DEVICE_LIMIT_REACHED");
  });
  it("a revoked computer cannot automatically reclaim its slot", () => {
    const rows = [{ deviceId: first, status: "revoked" }];
    expect(decideDeviceAccess(1, first, rows).code).toBe("DEVICE_REVOKED");
    expect(decideDeviceAccess(1, second, rows).allowed).toBe(true);
  });
});
