import React, { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardBreakdown, DashboardState } from "./OperationsDashboard";
import { usageDurationText, usageFeatureLabel } from "@/lib/usagePresentation";

type Day = { day: number; usedCustomers: number; monitoringMs: number; errors: number };
type DashboardData = { days: Day[]; features: { featureId: string; usedCustomers: number; uses: number }[];
  customers: { customerKey: string; customerName: string; monitoringMs: number; uses: number }[] };

export function fillUsageDays(from: string, to: string, rows: Day[]) {
  const start = Date.parse(from) / 86400000, end = Date.parse(to) / 86400000;
  const indexed = new Map(rows.map(row => [row.day, row]));
  return Array.from({ length: Math.max(0, Math.min(93, end - start + 1)) }, (_, i) => {
    const day = start + i, date = new Date(day * 86400000).toISOString().slice(0, 10);
    const row = indexed.get(day) || { day, usedCustomers: 0, monitoringMs: 0, errors: 0 };
    return { ...row, date, monitoringMinutes: row.monitoringMs / 60000 };
  });
}

export default function UsageDashboard({ data, loading, error, from, to, retry, onFeature, onCustomer, countsUses = false }:
  { data?: DashboardData; loading: boolean; error?: string; from: string; to: string; retry: () => void;
    onFeature: (id: string) => void; onCustomer: (id: string, label: string) => void; countsUses?: boolean }) {
  const [metric, setMetric] = useState<"usedCustomers" | "monitoringMinutes" | "errors">("usedCustomers");
  const days = fillUsageDays(from, to, data?.days || []);
  const chartLabel = metric === "usedCustomers" ? "每日业务使用客户 / 来源" : metric === "errors" ? "每日错误上报次数" : "每日监测时长（分钟）";
  const timeRanking = !countsUses && Boolean(data?.customers.some(row => row.monitoringMs > 0));
  return <DashboardState loading={loading} error={error} onRetry={retry}>
    {data && <>
      <section className="min-w-0 border-b pb-5" aria-label="使用趋势">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">使用趋势</h2>
          <select className="h-11 max-w-full rounded-md border bg-background px-3 text-sm" aria-label="趋势指标" value={metric} onChange={e => setMetric(e.target.value as typeof metric)}><option value="usedCustomers">业务使用客户 / 来源</option><option value="monitoringMinutes">监测时长（分钟）</option><option value="errors">错误上报次数</option></select>
        </div>
        {data.days.length ? <div className="h-56 min-w-0" role="img" aria-label={chartLabel}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={days} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="date" minTickGap={35} tickFormatter={value => value.slice(5)} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis width={48} allowDecimals={metric === "monitoringMinutes"} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "var(--background)", color: "var(--foreground)", borderColor: "var(--border)", borderRadius: 4 }} formatter={(value: number) => [metric === "monitoringMinutes" ? usageDurationText(value * 60000) : value, chartLabel]} />
            <Line dataKey={metric} name={chartLabel} type="linear" stroke={metric === "errors" ? "var(--chart-5)" : metric === "monitoringMinutes" ? "var(--chart-2)" : "var(--chart-1)"} strokeWidth={2} dot={days.length <= 7} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>
        </div> : <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">此范围内尚未收到使用上报</p>}
        <details className="mt-3 text-xs text-muted-foreground"><summary className="min-h-11 w-fit cursor-pointer py-3">每日数值 · UTC</summary><div className="max-h-64 overflow-auto"><table className="w-full text-left"><caption className="sr-only">使用趋势每日数值</caption><thead><tr><th className="py-2">日期</th><th>使用客户 / 来源</th><th>监测时长</th><th>错误</th></tr></thead><tbody>{days.map(row => <tr key={row.date} className="border-t"><td className="py-2">{row.date}</td><td>{row.usedCustomers}</td><td>{usageDurationText(row.monitoringMs)}</td><td>{row.errors}</td></tr>)}</tbody></table></div></details>
      </section>
      <div className="grid min-w-0 gap-x-8 border-b lg:grid-cols-2">
        <DashboardBreakdown title="业务功能使用排行" rows={data.features.filter(row => row.usedCustomers > 0).map(row => ({ id: row.featureId, label: usageFeatureLabel(row.featureId), value: row.usedCustomers, displayValue: `${row.usedCustomers} 个`, note: `已确认使用 ${row.uses} 次`, onClick: () => onFeature(row.featureId) }))} note="按使用客户 / 来源数排序，前 8 项；同一客户使用多个功能时分别计入。" empty="暂无已确认的业务功能使用" />
        <DashboardBreakdown title={timeRanking ? "客户监测时长排行" : "客户业务使用次数排行"} rows={data.customers.filter(row => row.uses > 0).map(row => ({ id: row.customerKey, label: row.customerName, value: timeRanking ? row.monitoringMs : row.uses, displayValue: timeRanking ? usageDurationText(row.monitoringMs) : `${row.uses} 次`, onClick: () => onCustomer(row.customerKey, row.customerName) }))} note="前 8 项；仅代表已确认并上传的业务使用。" empty="暂无已确认的客户业务使用" />
      </div>
    </>}
  </DashboardState>;
}
