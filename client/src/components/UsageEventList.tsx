import { useState } from "react";
import type { UsageFilters } from "../../../server/usageSchema";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { usageEventLabels, usageFeatureLabel, usageActionLabel, usageErrorLabel,
  usageMetricText, usageSystemLabel, usageTime } from "@/lib/usagePresentation";

const results: Record<string, string> = { success: "成功", failure: "失败", cancelled: "已取消", unknown: "结果未知" };

export default function UsageEventList({ filters, errorsOnly, enabled }: { filters: UsageFilters; errorsOnly: boolean; enabled: boolean }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ sourceId: number; installationId: string; eventId: string } | null>(null);
  const events = trpc.usage.events.useQuery({ filters, errorsOnly, page }, { enabled, refetchInterval: 60000 });
  const context = trpc.usage.context.useQuery(selected!, { enabled: enabled && selected !== null });

  return <section className="space-y-4" aria-label={errorsOnly ? "错误记录" : "操作记录"}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{errorsOnly ? "错误记录" : "操作记录"}</h2>
      <Button variant="outline" size="sm" onClick={() => void events.refetch()} disabled={events.isFetching}><RefreshCw className="size-4" aria-hidden="true" />刷新记录</Button>
    </div>
    {events.isError ? <p role="alert" className="py-6 text-sm text-destructive">记录加载失败，请重试。</p>
      : events.isPending ? <p role="status" className="py-8 text-sm text-muted-foreground">正在加载操作记录…</p>
      : !events.data?.items.length ? <p className="border-y border-dashed py-10 text-center text-sm text-muted-foreground">此范围内未观测到{errorsOnly ? "错误" : "操作"}记录。</p>
      : <ol className="divide-y">{events.data.items.map(row => <li key={`${row.sourceId}:${row.installationId}:${row.eventId}`} className="min-w-0 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {row.event.eventName === "error_reported" && <AlertCircle aria-hidden="true" className="size-4 text-destructive" />}
            <span>{usageEventLabels[row.event.eventName]}</span>
            {row.event.properties.result && <Badge variant="outline">{results[row.event.properties.result]}</Badge>}
            {row.event.eventName === "error_reported" && <Badge variant="outline">{Math.max(1, row.event.properties.count ?? 1)} 次</Badge>}
          </p><p className="mt-2 break-words text-sm">{row.customerName} · {usageFeatureLabel(row.event.properties.featureId || filters.featureId)} · v{row.event.appVersion}</p></div>
          <time className="text-xs text-muted-foreground">{usageTime(row.event.occurredAt)} UTC</time>
        </div>
        <p className="mt-2 break-words text-sm text-muted-foreground">{[
          row.event.properties.systemType && `系统：${usageSystemLabel(row.event.properties.systemType)}`,
          row.event.properties.action && `动作：${usageActionLabel(row.event.properties.action)}`,
          row.event.properties.mode && `模式：${row.event.properties.mode === "playback" ? "回放" : "实时"}`,
          row.event.eventName !== "error_reported" && usageMetricText(row.event.properties),
          row.event.properties.errorCode && `原因：${usageErrorLabel(row.event.properties.errorCode)}`,
          row.event.properties.algorithmId && `算法：${row.event.properties.algorithmId}`,
          row.event.properties.connectionType && `连接：${row.event.properties.connectionType}`,
          row.event.properties.format && `格式：${row.event.properties.format}`,
        ].filter(Boolean).join(" · ")}</p>
        {row.event.eventName === "error_reported" && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{row.event.properties.message || usageErrorLabel(row.event.properties.errorCode || "") || "客户端未提供错误描述"}</p>}
        <details className="mt-3 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer py-2">{errorsOnly ? "技术详情与调用栈" : "上报详情"}</summary>
          <p className="break-all">安装：{row.installationId} · 接收：{usageTime(row.receivedAt)} UTC</p>
          {row.event.properties.module && <p className="mt-2">模块：{row.event.properties.module} · 级别：{row.event.properties.severity || "未提供"}</p>}
          {row.event.properties.stack && <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-muted p-3 leading-6">{row.event.properties.stack}</pre>}
        </details>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => {
          if (selected?.sourceId === row.sourceId && selected.installationId === row.installationId && selected.eventId === row.eventId) void context.refetch();
          else setSelected({ sourceId: row.sourceId, installationId: row.installationId, eventId: row.eventId });
        }}>查看本次会话上下文</Button>
        {selected?.sourceId === row.sourceId && selected.installationId === row.installationId && selected.eventId === row.eventId && <div className="mt-3 border-l-2 pl-4 text-sm" aria-live="polite">
          {context.isPending ? "正在加载上下文…" : context.isError ? "会话上下文加载失败，请重试。" : <><p className="mb-3 font-medium">同安装、同会话的最近 20 条记录</p>
            <ol className="space-y-2">{context.data?.map(item => <li key={item.eventId} className="break-words"><time className="text-xs text-muted-foreground">{usageTime(item.occurredAt)}</time> · {usageEventLabels[item.eventName]}{item.properties.featureId ? ` · ${usageFeatureLabel(item.properties.featureId)}` : ""}{item.properties.action ? ` · ${usageActionLabel(item.properties.action)}` : ""}{item.properties.result ? ` · ${results[item.properties.result]}` : ""}</li>)}</ol></>}
        </div>}
      </li>)}</ol>}
    {events.data && <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>共 {events.data.total} 条 · 第 {events.data.page} / {Math.max(1, Math.ceil(events.data.total / events.data.pageSize))} 页</p>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={events.data.page <= 1 || events.isFetching} onClick={() => { setPage(events.data!.page - 1); setSelected(null); }}><ChevronLeft className="size-4" aria-hidden="true" />上一页</Button>
        <Button variant="outline" size="sm" disabled={events.data.page * events.data.pageSize >= events.data.total || events.isFetching} onClick={() => { setPage(events.data!.page + 1); setSelected(null); }}>下一页<ChevronRight className="size-4" aria-hidden="true" /></Button></div>
    </div>}
  </section>;
}
