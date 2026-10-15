import { describe, expect, it } from "vitest";
import { deviceLimitLabel, parseDeviceLimit } from "./licenseDeviceMode";

describe("computer-limited license form values", () => {
  it.each(["", " ", "0", "-1", "1.5", "1e2", "10001", "Infinity", "NaN"])("rejects %j instead of issuing an unlimited key", value => {
    expect(parseDeviceLimit(value)).toBeNull();
  });

  it.each([["1", 1], ["10000", 10000], [" 3 ", 3]] as const)("accepts %j", (value, result) => {
    expect(parseDeviceLimit(value)).toBe(result);
  });

  it("keeps the modern authorization requirement visible after removing an offline cap", () => {
    expect(deviceLimitLabel(0, true)).toBe("不限量（新版授权）");
    expect(deviceLimitLabel(0)).toBe("不限量");
    expect(deviceLimitLabel(undefined)).toBe("不限量");
    expect(deviceLimitLabel(3, true)).toBe("3 台");
  });
});
