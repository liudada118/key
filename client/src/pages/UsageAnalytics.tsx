import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";
import type { UsageFilters } from "../../../server/usageSchema";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Info, RefreshCw, X } from "lucide-react";
import UsageEventList from "@/components/UsageEventList";
import { usageFeatureLabel, usageFeaturePrimaryMetric, usageSystemLabel, usageDurationText, usageTime } from "@/lib/usagePresentation";
import "./usage-analytics.css";

type View = "customers" | "features";
type Section = "overview" | "systems" | "timeline" | "errors";
type Detail = { type: "customer" | "feature"; id: string; label: string; category?: string };
type Sort = "recent" | "usage" | "errors";
const selectClass = "h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Retain the API's existing UTC calendar contract for controls and timestamps. */
function recentFilters(days = 30): UsageFilters {
  return { from: new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10), environment: "production", identityScope: "company" };
}
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild><button type="button" aria-label={label} className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info aria-hidden="true" className="size-3.5" /></button></TooltipTrigger><TooltipContent className="max-w-80 leading-6">{children}</TooltipContent></Tooltip>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <div className="flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground"><label htmlFor={id}>{label}</label>{cloneElement(children as ReactElement<{ id?: string }>, { id })}</div>;
}
function QueryState({ loading, error, empty, children }: { loading: boolean; error: boolean; empty: boolean; children: ReactNode }) {
  if (error) return <p role="alert" className="py-10 text-sm text-destructive">数据加载失败，请点击刷新重试。</p>;
  if (loading) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">正在读取使用数据…</p>;
  if (empty) return <p className="border-y border-dashed py-12 text-center text-sm text-muted-foreground">此范围内尚未观测到匹配记录。</p>;
  return <>{children}</>;
}
function Pagination({ data, busy, onPage }: { data?: { total: number; page: number; pageSize: number }; busy: boolean; onPage: (page: number) => void }) {
  if (!data) return null;
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>共 {data.total} 项 · 第 {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</p><div className="flex gap-2">
    <Button variant="outline" size="sm" disabled={data.page <= 1 || busy} onClick={() => onPage(data.page - 1)}><ChevronLeft className="size-4" aria-hidden="true" /><span>上一页</span></Button>
    <Button variant="outline" size="sm" disabled={data.page * data.pageSize >= data.total || busy} onClick={() => onPage(data.page + 1)}><span>下一页</span><ChevronRight className="size-4" aria-hidden="true" /></Button>
  </div></div>;
}

/** Both perspectives retain bounded queries, historical attribution and the same drill-down scope. */
export default function UsageAnalytics() {
  const { user } = useAuth();
  const enabled = user?.role === "super_admin" && Boolean(user.isActive);
  const [filters, setFilters] = useState<UsageFilters>(recentFilters);
  const [draft, setDraft] = useState<UsageFilters>(filters);
  const [range, setRange] = useState("30");
  const [view, setView] = useState<View>("customers");
  const [section, setSection] = useState<Section>("overview");
  const [trail, setTrail] = useState<Detail[]>([]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("recent");
  const [category, setCategory] = useState<"business" | "diagnostic" | "all">("business");
  const [module, setModule] = useState("");
  const [moduleDraft, setModuleDraft] = useState("");
  const [system, setSystem] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const effective = { ...filters };
  trail.forEach(item => { if (item.type === "customer") effective.customerKey = item.id; else effective.featureId = item.id; });
  const activeList: View = trail.length ? trail[trail.length - 1].type === "feature" ? "customers" : "features" : view;
  const customers = trpc.usage.customers.useQuery(undefined, { enabled });
  const summary = trpc.usage.summary.useQuery(effective, { enabled, refetchInterval: 60000 });
  const customerUsage = trpc.usage.customerUsage.useQuery({ filters: effective, page, sort }, { enabled: enabled && section === "overview" && activeList === "customers", refetchInterval: 60000 });
  const featureUsage = trpc.usage.featureUsage.useQuery({ filters: effective, page, sort, category }, { enabled: enabled && section === "overview" && activeList === "features", refetchInterval: 60000 });
  const systems = trpc.usage.systems.useQuery(effective, { enabled: enabled && section === "systems", refetchInterval: 60000 });
  const period = Date.parse(draft.to) - Date.parse(draft.from);
  const valid = Number.isFinite(period) && period >= 0 && period < 93 * 86400000;
  const validModule = !moduleDraft || /^[A-Za-z0-9_.:-]{1,80}$/.test(moduleDraft);
  const eventFilters: UsageFilters = { ...effective, ...(system ? { systemType: system } : {}), ...(section === "errors" && module ? { module } : {}) };
  const scopeLabel = filters.identityScope === "unbound" ? "来源" : filters.identityScope === "all" ? "客户 / 来源" : "客户";
  const selectedFeature = trail.find(item => item.type === "feature");

  function clearDetail() { setTrail([]); setSection("overview"); setPage(1); setModule(""); setModuleDraft(""); setSystem(undefined); }
  function apply(next: UsageFilters) { setFilters(next); setDraft(next); clearDetail(); }
  function openDetail(item: Detail) {
    if (trail.some(entry => entry.type === item.type)) { setSection("timeline"); return; }
    setTrail([...trail, item]); setPage(1); setSection("overview"); setSystem(undefined);
    setSort(item.type === "feature" ? "recent" : "usage");
  }
  function changeSection(next: string) { setSection(next as Section); setPage(1); setModule(""); setModuleDraft(""); setSystem(undefined); }
  function refresh() {
    void summary.refetch(); void customers.refetch();
    if (section === "overview") { if (activeList === "customers") void customerUsage.refetch(); else void featureUsage.refetch(); }
    if (section === "systems") void systems.refetch();
    setRefreshKey(value => value + 1);
  }
  if (!enabled) return <p role="alert" className="p-6 text-sm text-muted-foreground">需要启用中的超级管理员账号查看客户使用情况。</p>;

  return <div className="usage-analytics min-w-0 space-y-5 p-4 md:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-2xl font-semibold"><BarChart3 aria-hidden="true" className="size-6" /><span>客户使用分析</span></h1><Button variant="outline" size="sm" onClick={refresh} disabled={summary.isFetching}><RefreshCw aria-hidden="true" className="size-4" /><span>刷新</span></Button></header>
    <form className="space-y-3 border-b pb-4" onSubmit={event => { event.preventDefault(); if (valid) apply(draft); }}>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_140px_auto]">
        <Field label="时间范围"><select className={selectClass} value={range} onChange={event => { const value = event.target.value; setRange(value); if (value !== "custom") apply({ ...draft, from: recentFilters(Number(value)).from, to: recentFilters(Number(value)).to }); }}><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="custom">自定义日期</option></select></Field>
        <Field label="客户公司"><select className={selectClass} value={draft.customerKey || ""} onChange={event => setDraft({ ...draft, customerKey: event.target.value || undefined })}><option value="">全部匹配客户</option>{customers.data?.filter(item => draft.identityScope === "unbound" ? item.customerKey.startsWith("source:") : draft.identityScope === "company" ? item.customerKey.startsWith("customer:") : true).map(item => <option key={item.customerKey} value={item.customerKey}>{item.customerName}</option>)}</select></Field>
        <Field label="归属范围"><select className={selectClass} value={draft.identityScope || "all"} onChange={event => setDraft({ ...draft, identityScope: event.target.value as UsageFilters["identityScope"], customerKey: undefined })}><option value="company">公司客户</option><option value="unbound">未绑定来源</option><option value="all">全部客户与来源</option></select></Field>
        <Field label="运行环境"><select className={selectClass} value={draft.environment} onChange={event => setDraft({ ...draft, environment: event.target.value as UsageFilters["environment"] })}><option value="production">正式环境</option><option value="development">开发环境</option><option value="test">测试环境</option><option value="all">全部环境</option></select></Field>
        <div className="col-span-2 flex items-end gap-2 xl:col-span-1"><Button type="submit" className="h-10" disabled={!valid}><span>查询</span></Button><Button type="button" variant="ghost" className="h-10" onClick={() => { setRange("30"); apply(recentFilters()); }}><span>重置</span></Button></div>
      </div>
      <details className="text-sm" open={range === "custom" || undefined}><summary className="w-fit cursor-pointer py-1 text-xs text-muted-foreground">日期与版本</summary><div className="mt-2 grid gap-3 sm:grid-cols-3"><Field label="开始日期（UTC）"><Input type="date" required value={draft.from} onChange={event => { setRange("custom"); setDraft({ ...draft, from: event.target.value }); }} /></Field><Field label="结束日期（UTC）"><Input type="date" required value={draft.to} onChange={event => { setRange("custom"); setDraft({ ...draft, to: event.target.value }); }} /></Field><Field label="软件版本"><Input maxLength={80} value={draft.appVersion || ""} placeholder="全部版本" onChange={event => setDraft({ ...draft, appVersion: event.target.value || undefined })} /></Field></div></details>
      {!valid && <p role="alert" className="text-xs text-destructive">请选择有效日期，查询范围不能超过 93 天。</p>}
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3"><Tabs value={view} onValueChange={value => { setView(value as View); clearDetail(); setSort(value === "features" ? "usage" : "recent"); }}><TabsList aria-label="分析视角"><TabsTrigger id="usage-view-customers" aria-controls="usage-view-content" value="customers">按客户看</TabsTrigger><TabsTrigger id="usage-view-features" aria-controls="usage-view-content" value="features">按功能看</TabsTrigger></TabsList></Tabs><p className="text-xs text-muted-foreground">{filters.from} 至 {filters.to} · UTC · {scopeLabel}</p></div>
    <div id="usage-view-content" role="tabpanel" aria-labelledby={`usage-view-${view}`} className="space-y-5">
    {trail.length > 0 && <nav aria-label="分析路径" className="flex flex-wrap items-center gap-2 text-sm"><Button variant="ghost" size="sm" onClick={clearDetail}><ArrowLeft className="size-4" aria-hidden="true" /><span>{view === "customers" ? "全部客户" : "全部功能"}</span></Button>{trail.map((item, index) => <span key={`${item.type}:${item.id}`} className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="text-muted-foreground">/</span><button type="button" className="break-words rounded px-1 py-2 text-left font-medium hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setTrail(trail.slice(0, index + 1)); setSection("overview"); setPage(1); setSystem(undefined); }}>{item.label}</button></span>)}</nav>}
    <QueryState loading={summary.isPending} error={summary.isError} empty={false}>
      {summary.data && <section className="usage-stats" aria-label="所选范围使用汇总">
        <div><p>业务使用{scopeLabel}<Tip label="业务使用口径">只计入已确认的监测、成功业务结果或有效工具操作；启动、入口展示、发起及错误不算业务使用。旧版缺少成功结果时不推断成功。</Tip></p><strong>{summary.data.usedCustomers}<small>{filters.identityScope === "company" ? "家" : "个"}</small></strong><span>已上报{scopeLabel} {summary.data.observedCustomers}</span></div>
        <div><p>已上报安装<Tip label="安装数口径">按授权来源与安装标识去重，不等于物理电脑或人员数量。</Tip></p><strong>{summary.data.installations}<small>个</small></strong><span>当前筛选范围</span></div>
        {effective.featureId && effective.featureId !== "monitoring" ? <div><p>已确认使用</p><strong>{summary.data.uses}<small>次</small></strong><span>成功结果 {summary.data.successes} · 失败 {summary.data.failures}</span></div> : <div><p>监测总时长<Tip label="监测时长口径">仅累加传感器监测汇总，不叠加软件运行、前台或采集时长。多安装可并行累计。</Tip></p><strong className="usage-duration">{summary.data.monitoringSamples ? usageDurationText(summary.data.monitoringMs) : "未上报时长"}</strong><span>{summary.data.monitoringSamples} 条时长记录</span></div>}
        <div><p>异常影响{scopeLabel}</p><strong>{summary.data.errorCustomers}<small>{filters.identityScope === "company" ? "家" : "个"}</small></strong><span>错误上报 {summary.data.errors} 次</span></div>
      </section>}
    </QueryState>
    <Tabs value={section} onValueChange={changeSection}><TabsList className="h-auto flex-wrap" aria-label="明细视图"><TabsTrigger id="usage-section-overview" aria-controls="usage-section-content" value="overview">{trail.length ? "使用明细" : "使用概览"}</TabsTrigger><TabsTrigger id="usage-section-systems" aria-controls="usage-section-content" value="systems">展示系统</TabsTrigger><TabsTrigger id="usage-section-timeline" aria-controls="usage-section-content" value="timeline">操作记录</TabsTrigger><TabsTrigger id="usage-section-errors" aria-controls="usage-section-content" value="errors">异常排查</TabsTrigger></TabsList></Tabs>
    <div id="usage-section-content" role="tabpanel" aria-labelledby={`usage-section-${section}`} className="space-y-4">
    {section === "overview" && <section className="min-w-0 space-y-4" aria-label={activeList === "features" ? "功能使用分析" : "客户使用情况"}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{activeList === "features" ? "功能使用情况" : effective.featureId ? "此功能的客户使用情况" : "客户使用情况"}</h2><div className="flex flex-wrap gap-2">
        {activeList === "features" && <select className={selectClass} aria-label="功能分类" value={category} onChange={event => { setCategory(event.target.value as typeof category); setPage(1); }}><option value="business">业务功能</option><option value="diagnostic">运行诊断</option><option value="all">全部功能与诊断</option></select>}
        <select className={selectClass} aria-label="排序方式" value={sort} onChange={event => { setSort(event.target.value as Sort); setPage(1); }}><option value="recent">最近业务使用优先</option><option value="usage">{activeList === "features" ? "使用客户数优先" : effective.featureId && effective.featureId !== "monitoring" ? "使用次数优先" : "监测时长优先"}</option><option value="errors">错误上报次数优先</option></select>
      </div></div>
      {activeList === "features" ? <>
        <QueryState loading={featureUsage.isPending} error={featureUsage.isError} empty={!featureUsage.data?.items.length}>
          <table className="usage-table"><caption className="sr-only">功能使用客户、主要业务指标、发起和结果</caption><thead><tr>{["功能", "使用客户 / 来源", "主要使用指标", "操作发起", "业务结果", "错误上报", "最近业务使用"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{featureUsage.data?.items.map(row => { const metric = usageFeaturePrimaryMetric(row); return <tr key={row.featureId}>
            <td><button type="button" className="usage-link" onClick={() => openDetail({ type: "feature", id: row.featureId, label: usageFeatureLabel(row.featureId), category: row.category })}>{usageFeatureLabel(row.featureId)}</button><span className="usage-secondary">{row.category === "diagnostic" ? "运行诊断" : `${row.exposures} 次入口展示`}</span></td>
            <td data-label="使用客户 / 来源">{row.usedCustomers}<span className="usage-secondary">观测到 {row.observedCustomers}</span></td>
            <td data-label="主要使用指标"><span>{metric.value}</span><span className="usage-secondary">{metric.label}</span>{row.featureId === "collection" && <span className="usage-secondary">时长：{row.collectionSamples ? usageDurationText(row.collectionMs) : "未上报"}</span>}</td>
            <td data-label="操作发起">{row.attempts}<span className="usage-secondary">不等于全部点击</span></td>
            <td data-label="业务结果">{row.successes + row.failures + row.cancelled + row.unknownResults > 0 ? <><span>成功 {row.successes}</span><span className="usage-secondary">失败 {row.failures} · 取消 {row.cancelled}</span>{row.unknownResults > 0 && <span className="usage-secondary">结果未明确 {row.unknownResults}</span>}</> : <span className="text-muted-foreground">未上报结果</span>}</td>
            <td data-label="错误上报">{row.errors ? <button type="button" className="usage-error" onClick={() => { if (!effective.featureId) setTrail([...trail, { type: "feature", id: row.featureId, label: usageFeatureLabel(row.featureId), category: row.category }]); setSection("errors"); }}>{row.errors} 次</button> : "未记录"}</td><td data-label="最近业务使用">{usageTime(row.lastUsedMs)}</td>
          </tr>; })}</tbody></table>
        </QueryState><Pagination data={featureUsage.data} busy={featureUsage.isFetching} onPage={setPage} />
      </> : <>
        <QueryState loading={customerUsage.isPending} error={customerUsage.isError} empty={!customerUsage.data?.items.length}>
          <table className="usage-table"><caption className="sr-only">客户系统、使用指标、最近使用及异常</caption><thead><tr>{(effective.featureId ? ["客户", "主要使用指标", "操作发起", "业务结果", "最近业务使用", "错误上报"] : ["客户", "展示系统", "监测时长", "采集时长", "最近业务使用", "错误上报"]).map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{customerUsage.data?.items.map(row => <tr key={row.customerKey}>
            <td><button type="button" className="usage-link" onClick={() => openDetail({ type: "customer", id: row.customerKey, label: row.customerName })}>{row.customerName}</button><span className="usage-secondary">{row.installations} 个安装 · {row.activeDays} 个使用日</span></td>
            {effective.featureId ? <><td data-label="主要使用指标">{usageFeaturePrimaryMetric({ ...row, featureId: effective.featureId, category: selectedFeature?.category || "business" }).value}</td><td data-label="操作发起">{row.attempts} 次</td><td data-label="业务结果">{row.successes + row.failures + row.cancelled + row.unknownResults > 0 ? <><span>成功 {row.successes}</span><span className="usage-secondary">失败 {row.failures} · 取消 {row.cancelled}</span>{row.unknownResults > 0 && <span className="usage-secondary">结果未明确 {row.unknownResults}</span>}</> : "未上报结果"}</td></> : <><td data-label="展示系统">{row.systemCount} 类</td><td data-label="监测时长">{row.monitoringSamples ? usageDurationText(row.monitoringMs) : "未上报时长"}</td><td data-label="采集时长">{row.collectionSamples ? usageDurationText(row.collectionMs) : "未上报时长"}</td></>}
            <td data-label="最近业务使用">{usageTime(row.lastUsedMs)}<span className="usage-secondary">最近上报：{usageTime(row.lastReceivedMs)}</span></td>
            <td data-label="错误上报">{row.errors ? <button type="button" className="usage-error" onClick={() => { if (!effective.customerKey) setTrail([...trail, { type: "customer", id: row.customerKey, label: row.customerName }]); setSection("errors"); }}>{row.errors} 次</button> : "未记录"}</td>
          </tr>)}</tbody></table>
        </QueryState><Pagination data={customerUsage.data} busy={customerUsage.isFetching} onPage={setPage} />
      </>}
    </section>}
    {section === "systems" && <section className="space-y-4"><h2 className="text-base font-semibold">展示系统使用</h2><QueryState loading={systems.isPending} error={systems.isError} empty={!systems.data?.length}>
      <table className="usage-table"><thead><tr>{["展示系统", "观测客户 / 来源", "已上报安装", "进入次数", "监测时长"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{systems.data?.map(row => <tr key={row.systemType}>
        <td><button type="button" className="usage-link" onClick={() => { setSystem(row.systemType); setSection("timeline"); }}>{usageSystemLabel(row.systemType)}</button></td><td data-label="观测客户 / 来源">{row.customers}</td><td data-label="已上报安装">{row.installations}</td><td data-label="进入次数">{row.entries}</td><td data-label="监测时长">{row.monitoringSamples ? usageDurationText(row.monitoringMs) : "未上报时长"}</td>
      </tr>)}</tbody></table></QueryState><p className="text-xs leading-6 text-muted-foreground">最多展示 100 类。匿名自定义系统标识仅在同一授权、同一安装内稳定，不跨电脑匹配自定义名称。</p>
    </section>}
    {(section === "timeline" || section === "errors") && <>
      {section === "errors" && <form className="flex max-w-md flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (validModule) setModule(moduleDraft); }}><div className="min-w-0 flex-1"><Field label="错误模块（精确匹配）"><Input maxLength={80} placeholder="全部错误模块" value={moduleDraft} onChange={event => setModuleDraft(event.target.value)} /></Field></div><Button size="sm" type="submit" disabled={!validModule}><span>筛选错误</span></Button>{!validModule && <p role="alert" className="basis-full text-xs text-destructive">模块标识仅支持字母、数字和 _.:-。</p>}</form>}
      {system && <div className="flex items-center gap-2 text-sm"><span>系统：{usageSystemLabel(system)}</span><Button variant="ghost" size="icon" aria-label="清除系统筛选" onClick={() => setSystem(undefined)}><X aria-hidden="true" className="size-4" /></Button></div>}
      <UsageEventList key={`${JSON.stringify(eventFilters)}:${section}:${refreshKey}`} filters={eventFilters} errorsOnly={section === "errors"} enabled={enabled} />
    </>}
    </div>
    </div>
    <footer className="border-t pt-4 text-xs leading-6 text-muted-foreground"><p className="flex items-start gap-2"><Info aria-hidden="true" className="mt-1 size-3.5 shrink-0" /><span>仅统计已埋点并成功上传的数据；未观测到不等于未使用。入口展示、操作发起、成功结果与错误上报分别统计，错误不等于失败操作总数。</span></p><details className="mt-2"><summary className="w-fit cursor-pointer py-1">统计口径</summary><p className="mt-2">客户归属使用首次接收时的历史快照；未绑定公司来源单独区分。操作有标识时按授权来源、安装、功能及操作标识去重；缺少标识时按事件计数。没有明确功能标识的错误仅进入全局错误记录。前台和交互窗口不等于员工工时；运行诊断不计入业务使用客户。日期与详情时间均为 UTC，离线补传按发生时间归属。</p></details></footer>
  </div>;
}
