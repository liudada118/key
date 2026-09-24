import { describe, expect, it } from "vitest";
import { usageDurationText, usageMetricText, usageSystemLabel } from "./usagePresentation";

describe("usage dashboard metric meanings", () => {
  it("keeps memory, frame gaps and long task durations in their actual units", () => {
    expect(usageMetricText({ featureId: "main_memory", count: 512 })).toBe("主进程峰值驻留内存：512 MiB");
    expect(usageDurationText(15000)).toBe("15 秒");
    expect(usageDurationText(60000)).toBe("1.0 分钟");
    expect(usageDurationText(7200000)).toBe("2.0 小时");
    expect(usageMetricText({ featureId: "sensor_frame_gap", count: 3, durationMs: 4200 })).toContain("不等于丢帧数");
    expect(usageMetricText({ featureId: "renderer_long_task", count: 2, durationMs: 320 })).toContain("累计 0.3 秒");
    expect(usageMetricText({ format: "csv", count: 3 })).toContain("文件数：3");
  });
  it("does not merge distinct pseudonymous systems or invent a customer title", () => {
    expect(usageSystemLabel("custom.0123456789abcdef")).toBe("自定义系统 · 0123456789abcdef");
    expect(usageSystemLabel("copy.0123456789abcdef")).toBe("系统副本 · 0123456789abcdef");
    expect(usageSystemLabel("custom")).toContain("未区分");
    expect(usageSystemLabel("copy")).toContain("未区分");
  });
});
