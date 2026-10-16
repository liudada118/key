import { describe, expect, it } from "vitest";
import { usageActionLabel, usageErrorLabel, usageFeatureLabel, usageDurationText, usageMetricText, usageSystemLabel, usageFeaturePrimaryMetric, usageTime } from "./usagePresentation";

describe("usage dashboard metric meanings", () => {
  it("presents new controls, frame summaries and confirmed rows in their own units", () => {
    expect(usageFeatureLabel("tuning_gaussian")).toBe("高斯平滑");
    expect(usageActionLabel("restore_update_display")).toBe("恢复 · 展示配置");
    expect(usageMetricText({ featureId: "sensor_frames", count: 1500, durationMs: 30000 })).toContain("50.0 帧/秒");
    expect(usageMetricText({ featureId: "sensor_frames", count: 1500, durationMs: 30000 })).toContain("不等于丢帧统计");
    expect(usageMetricText({ featureId: "collection", count: 209, durationMs: 4200 })).toContain("已保存 209 条帧记录");
    expect(usageMetricText({ featureId: "webpage_update", action: "download_ready", count: 1048576 })).toContain("1.00 MiB");
    expect(usageActionLabel("future-action")).toBe("future-action");
    expect(usageErrorLabel("DEVICE_LIMIT_REACHED")).toContain("电脑数量上限");
    expect(usageErrorLabel("future-error")).toBe("future-error");
  });
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
  it("uses domain metrics instead of raw exposure/attempt totals and preserves missing duration", () => {
    const row = { featureId: "monitoring", category: "business", uses: 4, successes: 2,
      observedEvents: 1000, monitoringMs: 60000, monitoringSamples: 1, collectionMs: 30000, collectionSamples: 1 };
    expect(usageFeaturePrimaryMetric(row)).toEqual({ label: "监测时长", value: "1.0 分钟" });
    expect(usageFeaturePrimaryMetric({ ...row, monitoringSamples: 0 }).value).toBe("未上报时长");
    expect(usageFeaturePrimaryMetric({ ...row, monitoringMs: 0 }).value).toBe("0 秒");
    expect(usageFeaturePrimaryMetric({ ...row, featureId: "collection" }).value).toBe("2 次");
    expect(usageFeaturePrimaryMetric({ ...row, featureId: "export" }).value).toBe("2 次");
    expect(usageFeaturePrimaryMetric({ ...row, featureId: "playback" }).value).toBe("4 次");
    expect(usageFeaturePrimaryMetric({ ...row, featureId: "tuning_gaussian" }).value).toBe("4 次");
    expect(usageFeaturePrimaryMetric({ ...row, featureId: "main_memory", category: "diagnostic" }).value).toBe("1000 条");
  });
  it("uses UTC consistently and distinguishes an absent last use from the Unix epoch", () => {
    expect(usageTime(null)).toBe("未观测到");
    expect(usageTime("2026-10-16T23:30:00Z")).toContain("2026/10/16");
    expect(usageSystemLabel("jqbed")).toBe("小床监测");
  });
});
