import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, BarChart3, RefreshCw } from "lucide-react";

const eventLabels: Record<string, string> = {
  app_session_started: "软件启动", feature_exposed: "功能入口展示", feature_attempted: "功能操作发起",
  system_entered: "进入系统", device_connection_result: "设备连接结果", monitoring_usage_summary: "监测时长汇总",
  collection_started: "开始采集", collection_finished: "结束采集", export_result: "导出结果",
  playback_started: "开始回放", algorithm_result: "算法结果", analysis_tool_used: "分析工具",
  custom_system_saved: "保存自定义系统", agent_task_result: "Agent 任务结果", usage_session_summary: "使用时长汇总",
  error_reported: "错误上报",
};
const resultLabels: Record<string, string> = { success: "成功", failure: "失败", cancelled: "已取消", unknown: "未知" };
type Filters = { from: string; to: string; environment: "production" | "development" | "test" | "all"; customerKey?: string; appVersion?: string; module?: string };
type SelectedEvent = { sourceId: number; installationId: string; eventId: string };
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Format recorded timestamps without treating an absent upload as zero usage. */
function time(value: string | number | Date) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
/** Display usage duration in hours with one decimal place. */
function hours(value: number) { return `${(value / 3600000).toFixed(1)} 小时`; }
/** Start the dashboard on the most recent 30 UTC calendar days. */
function initialFilters(): Filters {
  return { from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10), environment: "production" };
}

/** Show feature adoption, customer activity and scoped error context to active super administrators. */
export default function UsageAnalytics() {
  const { user } = useAuth();
  const enabled = user?.role === "super_admin" && user.isActive;
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [draft, setDraft] = useState<Filters>(filters);
  const [tab, setTab] = useState("overview");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SelectedEvent | null>(null);
  const customers = trpc.usage.customers.useQuery(undefined, { enabled });
  const overview = trpc.usage.overview.useQuery(filters, { enabled, refetchInterval: 60000 });
  const events = trpc.usage.events.useQuery({ filters, errorsOnly: tab === "errors", page }, { enabled: enabled && tab !== "overview", refetchInterval: 60000 });
  const context = trpc.usage.context.useQuery(selected!, { enabled: enabled && selected !== null });
  const period = Date.parse(draft.to) - Date.parse(draft.from);
  const valid = Number.isFinite(period) && period >= 0 && period < 93 * 86400000
    && (!draft.module || /^[A-Za-z0-9_.:-]{1,80}$/.test(draft.module));
  const data = overview.data;

  /** Apply validated filters and reset detail paging to avoid showing another customer's stale selection. */
  function apply(next: Filters) { setFilters(next); setDraft(next); setPage(1); setSelected(null); }
  /** Refresh the active view and available customer identities. */
  function refresh() { void overview.refetch(); void customers.refetch(); if (tab !== "overview") void events.refetch(); }

  if (!enabled) return <p role="alert" className="p-6 text-sm text-muted-foreground">需要启用中的超级管理员账号查看客户使用情况。</p>;

  return <div className="min-w-0 space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><BarChart3 aria-hidden="true" className="size-6" />客户使用分析</h1>
        <p className="mt-2 text-sm text-muted-foreground">查看客户使用的功能、操作结果与软件错误。按事件发生日期（UTC）统计。</p></div>
      <Button variant="outline" className="min-h-11" onClick={refresh} disabled={overview.isFetching || events.isFetching}><RefreshCw aria-hidden="true" className="size-4" /><span>刷新</span></Button>
    </header>

    <form className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); if (valid) apply(draft); }}>
      <label className="space-y-1.5 text-sm"><span>开始日期</span><Input className="h-11" type="date" required value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
      <label className="space-y-1.5 text-sm"><span>结束日期</span><Input className="h-11" type="date" required value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
      <label className="space-y-1.5 text-sm"><span>客户公司</span><select className={selectClass} value={draft.customerKey ?? ""} onChange={event => setDraft({ ...draft, customerKey: event.target.value || undefined })}>
        <option value="">全部已上报客户</option>{customers.data?.map(customer => <option key={customer.customerKey} value={customer.customerKey}>{customer.customerName}</option>)}</select></label>
      <label className="space-y-1.5 text-sm"><span>运行环境</span><select className={selectClass} value={draft.environment} onChange={event => setDraft({ ...draft, environment: event.target.value as Filters["environment"] })}>
        <option value="production">正式环境</option><option value="development">开发环境</option><option value="test">测试环境</option><option value="all">全部环境</option></select></label>
      <label className="space-y-1.5 text-sm"><span>软件版本（精确匹配）</span><Input className="h-11" maxLength={80} placeholder="全部版本" value={draft.appVersion ?? ""} onChange={event => setDraft({ ...draft, appVersion: event.target.value || undefined })} /></label>
      <label className="space-y-1.5 text-sm"><span>错误模块（精确匹配）</span><Input className="h-11" maxLength={80} placeholder="全部模块" value={draft.module ?? ""} onChange={event => setDraft({ ...draft, module: event.target.value || undefined })} /></label>
      <div className="flex items-end gap-2"><Button type="submit" className="min-h-11" disabled={!valid}><span>应用筛选</span></Button><Button type="button" variant="ghost" className="min-h-11" onClick={() => apply(initialFilters())}><span>重置</span></Button></div>
      <p className="self-end text-xs leading-5 text-muted-foreground">最多查询 93 天；错误模块筛选同时影响所有统计。{!valid && <span className="block text-destructive" role="alert">请检查日期范围和模块标识。</span>}</p>
    </form>

    {overview.isError ? <div role="alert" className="rounded-lg border border-destructive p-5"><p className="font-medium">使用数据加载失败</p><p className="mt-1 text-sm">请稍后重试；尚未部署接收服务或数据库迁移时也会出现此提示。</p></div>
      : overview.isPending ? <p role="status" className="py-10 text-center text-muted-foreground">正在读取客户使用数据…</p> : data && <>
        <section aria-label="使用概览" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[["有数据的客户", data.totals.customers], ["安装实例", data.totals.installations], ["已记录事件", data.totals.events], ["错误发生次数", data.totals.errors], ["不同错误", data.totals.uniqueErrors]].map(([label, value]) =>
            <div key={label} className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{Number(value).toLocaleString("zh-CN")}</p></div>)}
        </section>
        {data.totals.events === 0 && <div className="rounded-lg border border-dashed p-8 text-center"><p className="font-medium">此范围内还没有上报数据</p><p className="mt-2 text-sm text-muted-foreground">客户需使用支持埋点的版本并联网完成上传。没有数据不能判断为没有使用。</p></div>}
        <Tabs value={tab} onValueChange={value => { setTab(value); setPage(1); setSelected(null); }}><TabsList className="h-auto flex-wrap"><TabsTrigger className="min-h-11" value="overview">功能与客户</TabsTrigger><TabsTrigger className="min-h-11" value="timeline">操作时间线</TabsTrigger><TabsTrigger className="min-h-11" value="errors">错误记录</TabsTrigger></TabsList></Tabs>

        {tab === "overview" ? <div className="space-y-6">
          <section className="min-w-0 rounded-lg border bg-card p-4"><h2 className="text-lg font-medium">功能使用排行</h2><p className="mt-1 text-xs text-muted-foreground">按事件类型和功能分开统计，展示前 {data.listLimit} 项。入口展示、尝试和完成分别计数。</p>
            <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">功能使用数量、客户覆盖和结果</caption><thead><tr className="border-b text-muted-foreground">{["功能 / 事件", "客户数", "事件数", "成功 / 失败", "有数据天数"].map(title => <th key={title} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{title}</th>)}</tr></thead>
              <tbody>{data.features.map(row => <tr key={`${row.eventName}:${row.featureId}`} className="border-b last:border-0"><td className="px-3 py-3"><span>{eventLabels[row.eventName] ?? row.eventName}</span>{row.featureId && <span className="mt-1 block text-xs text-muted-foreground">{row.featureId}</span>}</td><td className="px-3 py-3 tabular-nums">{row.customers}</td><td className="px-3 py-3 tabular-nums">{row.events}</td><td className="px-3 py-3 tabular-nums">{row.successes} / {row.failures}</td><td className="px-3 py-3 tabular-nums">{row.activeDays}</td></tr>)}</tbody></table></div>
          </section>
          <section className="rounded-lg border bg-card p-4"><h2 className="text-lg font-medium">客户使用情况</h2><p className="mt-1 text-xs text-muted-foreground">按记录数展示前 {data.listLimit} 家。点击客户查看它的功能及操作时间线。</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">客户安装数、使用天数、监测采集时长及错误</caption><thead><tr className="border-b text-muted-foreground">{["客户", "安装 / 天数", "监测 / 采集", "错误次数", "最近使用"].map(title => <th key={title} scope="col" className="whitespace-nowrap px-3 py-3 font-medium">{title}</th>)}</tr></thead><tbody>{data.customers.map(row => <tr key={row.customerKey} className="border-b last:border-0"><td className="px-3 py-2"><Button variant="link" className="h-auto min-h-11 max-w-64 whitespace-normal px-0 text-left" onClick={() => apply({ ...filters, customerKey: row.customerKey })}><span>{row.customerName}</span></Button></td><td className="px-3 py-3">{row.installations} / {row.activeDays}</td><td className="whitespace-nowrap px-3 py-3">{hours(row.monitoringMs)} / {hours(row.collectionMs)}</td><td className="px-3 py-3">{row.errors}</td><td className="whitespace-nowrap px-3 py-3">{time(row.lastOccurredMs)}</td></tr>)}</tbody></table></div></section>
          {data.days.length > 0 && <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer font-medium">每日趋势（UTC）</summary><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.days.map(day => <div key={day.day} className="rounded border p-3 text-sm"><time>{new Date(day.day * 86400000).toISOString().slice(0, 10)}</time><p className="mt-1 text-muted-foreground">{day.customers} 家客户 · {day.events} 条事件 · {day.errors} 次错误</p></div>)}</div></details>}
        </div> : <section className="space-y-4" aria-label={tab === "errors" ? "错误记录" : "操作时间线"}>
          <p className="text-sm text-muted-foreground">{tab === "errors" ? "重复错误按次数合并；展开可查看脱敏信息和出错前的操作。" : "仅显示已埋点并上传的操作；发生时间与接收时间可能因离线而不同。"}</p>
          {events.isError ? <p role="alert" className="text-destructive">记录加载失败，请点击刷新重试。</p> : events.isPending ? <p role="status">正在加载记录…</p> : !events.data?.items.length ? <p className="rounded border border-dashed p-6 text-muted-foreground">没有符合筛选条件的记录。</p> : events.data.items.map(row => <article key={`${row.sourceId}:${row.installationId}:${row.eventId}`} className="min-w-0 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-medium">{row.event.eventName === "error_reported" && <AlertCircle aria-hidden="true" className="size-4 text-destructive" />}<span>{eventLabels[row.event.eventName]}</span>{row.event.properties.result && <Badge variant="outline">{resultLabels[row.event.properties.result]}</Badge>}{row.event.eventName === "error_reported" && <Badge variant="outline">{Math.max(1, row.event.properties.count ?? 1)} 次</Badge>}</p><p className="mt-2 break-words text-sm">{row.customerName} · {row.event.properties.featureId ?? row.event.properties.module ?? row.event.properties.systemType ?? "软件"} · v{row.event.appVersion}</p></div><time className="text-sm text-muted-foreground">{time(row.event.occurredAt)}</time></div>
            <p className="mt-2 break-all text-xs text-muted-foreground">安装 {row.installationId} · 接收 {time(row.receivedAt)}</p>
            <p className="mt-2 break-words text-sm text-muted-foreground">{[
              row.event.properties.systemType && `系统：${row.event.properties.systemType}`,
              row.event.properties.algorithmId && `算法：${row.event.properties.algorithmId}`,
              row.event.properties.mode && `模式：${row.event.properties.mode === "playback" ? "回放" : "实时"}`,
              row.event.properties.durationMs !== undefined && `耗时/时长：${(row.event.properties.durationMs / 1000).toFixed(1)} 秒`,
              row.event.properties.format && `格式：${row.event.properties.format}`,
              row.event.properties.connectionType && `连接：${row.event.properties.connectionType}`,
              row.event.eventName !== "error_reported" && row.event.properties.count !== undefined && `数量：${row.event.properties.count}`,
            ].filter(Boolean).join(" · ")}</p>
            {row.event.eventName === "error_reported" && <div className="mt-3 space-y-2"><p className="whitespace-pre-wrap break-words text-sm">{row.event.properties.message || row.event.properties.errorCode || row.event.properties.errorType || "客户端未提供错误描述"}</p><details><summary className="cursor-pointer py-2 text-sm">错误详情与调用栈</summary><p className="text-xs text-muted-foreground">模块：{row.event.properties.module ?? "未知"} · 动作：{row.event.properties.action ?? "未知"} · 级别：{row.event.properties.severity ?? "error"}</p><pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs leading-6">{row.event.properties.stack || "未提供调用栈"}</pre></details></div>}
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => setSelected({ sourceId: row.sourceId, installationId: row.installationId, eventId: row.eventId })}><span>查看本次会话上下文</span></Button>
            {selected?.sourceId === row.sourceId && selected.installationId === row.installationId && selected.eventId === row.eventId && <div className="mt-3 rounded bg-muted p-4" aria-live="polite">{context.isPending ? "正在加载上下文…" : context.isError ? "上下文加载失败，请重试。" : <><p className="mb-2 text-sm font-medium">同安装、同会话的最近 20 条记录</p><ol className="space-y-2 text-sm">{context.data?.map(item => <li key={item.eventId} className="break-words"><time className="text-muted-foreground">{time(item.occurredAt)}</time> · {eventLabels[item.eventName]}{item.properties.featureId ? ` · ${item.properties.featureId}` : ""}{item.properties.result ? ` · ${resultLabels[item.properties.result]}` : ""}</li>)}</ol></>}</div>}
          </article>)}
          {events.data && <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">共 {events.data.total} 条记录 · 第 {events.data.page} / {Math.max(1, Math.ceil(events.data.total / events.data.pageSize))} 页</p><div className="flex gap-2"><Button variant="outline" className="min-h-11" disabled={events.data.page <= 1 || events.isFetching} onClick={() => { setPage(events.data!.page - 1); setSelected(null); }}><span>上一页</span></Button><Button variant="outline" className="min-h-11" disabled={events.data.page * events.data.pageSize >= events.data.total || events.isFetching} onClick={() => { setPage(events.data!.page + 1); setSelected(null); }}><span>下一页</span></Button></div></div>}
        </section>}
        <p className="text-xs leading-6 text-muted-foreground">客户名称按首次接收时的授权归属保留；软件换密钥后的来源单独记录。安装数按授权来源与安装标识组合计数。同一公司多份授权可能对应同一物理设备。当前统计不推断未授权功能，也不把未上传算作未使用。</p>
      </>}
  </div>;
}
