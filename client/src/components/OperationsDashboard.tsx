import React, { type ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Metric = { label: string; value: ReactNode; note: string; onClick?: () => void; tone?: number };
export function DashboardMetrics({ items }: { items: Metric[] }) {
  return <section aria-label="关键指标" className="grid grid-cols-2 border-y bg-background lg:grid-cols-4">
    {items.map((item, i) => {
      const content = <><span className="flex items-start justify-between gap-2 text-sm text-muted-foreground"><span>{item.label}</span>{item.onClick && <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />}</span>
        <strong className="my-3 block break-words text-3xl font-semibold tabular-nums" style={{ color: `var(--chart-${item.tone || i % 3 + 1})` }}>{item.value}</strong>
        <span className="block text-xs leading-5 text-muted-foreground">{item.note}</span></>;
      const className = "min-w-0 border-b p-4 text-left lg:border-b-0 lg:[&:not(:last-child)]:border-r";
      return item.onClick ? <button type="button" key={item.label} className={`${className} hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring`} onClick={item.onClick}>{content}</button>
        : <div key={item.label} className={className}>{content}</div>;
    })}
  </section>;
}

export type BreakdownRow = { id: string; label: string; value: number; displayValue?: string; note?: string; tone?: number; onClick?: () => void };
export function DashboardBreakdown({ title, rows, note, empty = "暂无匹配数据" }: { title: string; rows: BreakdownRow[]; note?: string; empty?: string }) {
  const maximum = Math.max(1, ...rows.map(row => row.value));
  return <section className="min-w-0 space-y-4 py-5" aria-label={title}>
    <h2 className="text-base font-semibold">{title}</h2>
    {rows.length ? <ul className="space-y-2">{rows.map((row, i) => {
      const content = <><span className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{row.label}</span><span className="shrink-0 font-medium tabular-nums">{row.displayValue ?? row.value.toLocaleString("zh-CN")}</span></span>
        <span aria-hidden="true" className="mt-2 block h-2 overflow-hidden rounded-sm bg-muted"><span className="block h-full rounded-sm" style={{ width: `${Math.max(0, row.value) / maximum * 100}%`, background: `var(--chart-${row.tone || i % 3 + 1})` }} /></span>
        {row.note && <span className="mt-1 block text-xs text-muted-foreground">{row.note}</span>}</>;
      return <li key={row.id}>{row.onClick ? <button type="button" onClick={row.onClick} className="block min-h-11 w-full rounded-sm p-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${row.label}：${row.displayValue ?? row.value}，查看明细`}>{content}</button>
        : <div className="min-h-11 p-2">{content}</div>}</li>;
    })}</ul> : <p className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">{empty}</p>}
    {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
  </section>;
}

export function DashboardState({ loading, error, onRetry, children }: { loading: boolean; error?: string | null; onRetry: () => void; children: ReactNode }) {
  if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-y py-8"><p className="text-sm text-destructive">{error}</p><Button className="h-11" variant="outline" onClick={onRetry}><RefreshCw aria-hidden="true" className="size-4" /><span>重试</span></Button></div>;
  if (loading) return <div role="status" className="flex min-h-64 items-center justify-center border-y text-sm text-muted-foreground">正在读取看板数据...</div>;
  return <>{children}</>;
}
