import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardBreakdown, DashboardMetrics, DashboardState } from "./OperationsDashboard";
import { fillUsageDays } from "./UsageDashboard";

describe("dashboard presentation", () => {
  it("keeps metrics semantic and drill-downs keyboard operable", () => {
    const html = renderToStaticMarkup(<DashboardMetrics items={[{ label: "客户总数", value: 103, note: "全部可见客户", onClick() {} }, { label: "部门待完善", value: "暂不可用", note: "来源失败" }]} />);
    expect(html).toContain("103");
    expect(html).toContain("暂不可用");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
  });
  it("retains exact counts and accessible names instead of color-only charts", () => {
    const html = renderToStaticMarkup(<DashboardBreakdown title="事业部分布" rows={[{ id: "a", label: "事业部甲", value: 20, onClick() {} }]} />);
    expect(html).toContain("事业部甲：20，查看明细");
    expect(html).toContain("width:100%");
    expect(renderToStaticMarkup(<DashboardBreakdown title="事业部分布" rows={[]} />)).toContain("暂无匹配数据");
  });
  it("never displays stale chart children during a load error", () => {
    const html = renderToStaticMarkup(<DashboardState loading={false} error="读取失败" onRetry={() => {}}><p>stale counts</p></DashboardState>);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("stale counts");
  });
  it("fills UTC dates over month boundaries without mixing units or exceeding the bound", () => {
    const day = Date.parse("2026-09-30") / 86400000;
    const result = fillUsageDays("2026-09-30", "2026-10-02", [{ day, usedCustomers: 3, monitoringMs: 120000, errors: 2 }]);
    expect(result.map(row => row.date)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(result[0].monitoringMinutes).toBe(2);
    expect(result[1]).toMatchObject({ usedCustomers: 0, monitoringMs: 0, errors: 0 });
    expect(fillUsageDays("2026-01-01", "2026-12-01", [])).toHaveLength(93);
  });
});
