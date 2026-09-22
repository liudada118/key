import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, ChevronLeft, ChevronRight, MessageSquare, Paperclip, RefreshCw, User } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";

type Selection = { customerId: number; installationId: string; conversationId: string };
const customerLabel = (id: number, name?: string | null) => name || `客户 #${id}（已删除）`;
const time = (value?: string | Date | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未提供时间";
const taskLabels: Record<string, string> = {
  pending: "待处理", queued: "排队中", running: "进行中", succeeded: "已完成", failed: "失败", cancelled: "已取消",
  waiting_approval: "待确认", awaiting_approval: "待确认", interrupted: "已中断",
};

function Pager({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label: string }) {
  return <nav aria-label={label} className="flex shrink-0 items-center justify-center gap-3 border-t py-2">
    <Button variant="ghost" size="icon" className="size-11" title="上一页" aria-label={`${label}上一页`} disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft /></Button>
    <span className="min-w-16 text-center text-xs text-muted-foreground">{page} / {Math.max(1, pages)}</span>
    <Button variant="ghost" size="icon" className="size-11" title="下一页" aria-label={`${label}下一页`} disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight /></Button>
  </nav>;
}

export default function AgentChats() {
  const { user } = useAuth();
  const enabled = user?.role === "super_admin" && user.isActive;
  const [customer, setCustomer] = useState("");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [messagePage, setMessagePage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [tab, setTab] = useState("messages");
  const bodyRef = useRef<HTMLDivElement>(null);
  const queryOptions = { enabled, refetchInterval: 30000, retry: false };
  const customers = trpc.agentSync.chatCustomers.useQuery(undefined, queryOptions);
  const conversations = trpc.agentSync.conversations.useQuery({ customerId: customer ? Number(customer) : undefined, page, pageSize: 20 }, queryOptions);
  const detail = trpc.agentSync.conversation.useQuery({
    customerId: selection?.customerId ?? 1,
    installationId: selection?.installationId ?? "00000000-0000-4000-8000-000000000000",
    conversationId: selection?.conversationId ?? "none", messagePage, taskPage,
  }, { ...queryOptions, enabled: Boolean(enabled && selection), gcTime: 0 });

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [selection, messagePage, taskPage, tab]);
  const selected = detail.data;
  const attachments = new Map(selected?.attachments.map(attachment => [attachment.id, attachment]));
  const refresh = () => { void customers.refetch(); void conversations.refetch(); if (selection) void detail.refetch(); };
  const isRefreshing = customers.isFetching || conversations.isFetching || detail.isFetching;

  if (!enabled) return <div role="alert" className="py-12 text-center text-muted-foreground">仅超级管理员可查看聊天记录</div>;

  return <div className="min-w-0 space-y-4" translate="no">
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><MessageSquare className="size-5 shrink-0 text-primary" /><h1 className="text-2xl font-semibold">Agent 聊天</h1></div>
      <Button variant="outline" size="icon" className="size-11" onClick={refresh} disabled={isRefreshing} title="刷新聊天" aria-label="刷新聊天"><RefreshCw className={isRefreshing ? "animate-spin" : ""} /></Button>
    </header>

    <div className="flex flex-wrap items-center gap-3 border-b pb-4">
      <Label htmlFor="chat-customer">客户</Label>
      <select id="chat-customer" value={customer} onChange={event => { setCustomer(event.target.value); setPage(1); setSelection(null); }}
        className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:w-72">
        <option value="">全部客户</option>
        {customers.data?.map(item => <option key={item.customerId} value={item.customerId}>{customerLabel(item.customerId, item.name)} ({item.conversationCount})</option>)}
      </select>
      <span className="text-sm text-muted-foreground">{conversations.data?.total ?? 0} 个会话</span>
      {customers.error && <span role="alert" className="text-sm text-destructive">客户列表加载失败</span>}
    </div>

    <div className="grid h-[min(760px,calc(100dvh-220px))] min-h-[420px] min-w-0 grid-cols-1 border-b lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <section aria-label="会话列表" className={`${selection ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col lg:border-r`}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.isLoading ? <p role="status" className="p-6 text-sm text-muted-foreground">正在加载会话…</p>
            : conversations.error ? <div role="alert" className="space-y-3 p-6"><p className="text-sm text-destructive">会话加载失败</p><Button variant="outline" onClick={() => void conversations.refetch()}>重试</Button></div>
            : !conversations.data?.items.length ? <p className="p-6 text-sm text-muted-foreground">暂无已同步的聊天</p>
            : conversations.data.items.map(item => {
              const active = selection?.customerId === item.customerId && selection.installationId === item.installationId && selection.conversationId === item.conversationId;
              return <button key={`${item.customerId}/${item.installationId}/${item.conversationId}`} type="button" aria-pressed={active}
                onClick={() => { setSelection({ customerId: item.customerId, installationId: item.installationId, conversationId: item.conversationId }); setMessagePage(1); setTaskPage(1); setTab("messages"); }}
                className={`block w-full min-w-0 cursor-pointer border-b border-l-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${active ? "border-l-primary bg-accent" : "border-l-transparent hover:bg-muted/60"}`}>
                <div className="flex min-w-0 items-start justify-between gap-2"><span className="truncate text-sm font-medium">{customerLabel(item.customerId, item.customerName)}</span><span className="shrink-0 text-xs text-muted-foreground">{item.messageCount} 条</span></div>
                <p className="mt-2 line-clamp-2 text-sm [overflow-wrap:anywhere]">{item.preview || "空会话"}</p>
                <p className="mt-2 truncate text-xs text-muted-foreground" title={item.conversationId}>{item.conversationId}</p>
                <p className="mt-1 text-xs text-muted-foreground">{time(item.receivedAt)}</p>
              </button>;
            })}
        </div>
        <Pager label="会话列表" page={conversations.data?.page ?? page} pages={Math.ceil((conversations.data?.total ?? 0) / 20)} onChange={setPage} />
      </section>

      <section aria-label="会话详情" className={`${selection ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col lg:pl-6`}>
        {selection && <Button variant="ghost" className="mb-2 h-11 self-start lg:hidden" onClick={() => setSelection(null)}><ArrowLeft />返回会话</Button>}
        {!selection ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">未选择会话</div>
          : detail.isLoading ? <p role="status" className="py-8 text-sm text-muted-foreground">正在加载消息…</p>
          : detail.error ? <div role="alert" className="space-y-3 py-8"><p className="text-sm text-destructive">{detail.error.data?.code === "NOT_FOUND" ? "会话不存在" : "消息加载失败"}</p><Button variant="outline" onClick={() => void detail.refetch()}>重试</Button></div>
          : selected && <>
            <header className="space-y-2 border-b pb-3">
              <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{customerLabel(selected.customerId, selected.customerName)}</h2>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">会话：{selected.conversationId}</p>
              <details className="text-xs text-muted-foreground"><summary className="w-fit cursor-pointer py-1">同步信息</summary>
                <dl className="mt-2 grid gap-1 [overflow-wrap:anywhere]"><div>安装标识：{selected.installationId}</div><div>软件版本：{selected.appVersion || "未提供"}</div><div>快照版本：{selected.revision}</div><div>最近同步：{time(selected.receivedAt)}</div></dl>
              </details>
              <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="messages">消息 ({selected.messageCount})</TabsTrigger><TabsTrigger value="tasks">任务 ({selected.taskCount})</TabsTrigger></TabsList></Tabs>
            </header>
            <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto py-4 pr-2">
              {tab === "messages" ? <div className="space-y-5">
                {!selected.messages.length && <p className="text-sm text-muted-foreground">暂无消息</p>}
                {selected.messages.map(message => <article key={message.id} className="min-w-0 border-b pb-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className={`flex items-center gap-1.5 font-medium ${message.role === "user" ? "text-primary" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {message.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}{message.role === "user" ? "用户" : "助手"}</span><time className="text-muted-foreground">{time(message.createdAt)}</time></div>
                  <div className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">{message.text || "（空消息）"}</div>
                  {Boolean(message.attachmentIds?.length) && <ul className="mt-3 flex flex-wrap gap-2">{message.attachmentIds?.map((id, index) => <li key={`${id}:${index}`} className="flex max-w-full min-w-0 items-start gap-1.5 rounded border px-2 py-1 text-xs text-muted-foreground"><Paperclip className="mt-0.5 size-3 shrink-0" /><span className="[overflow-wrap:anywhere]">{attachments.get(id)?.name || id}</span></li>)}</ul>}
                </article>)}
              </div> : <div className="divide-y">
                {!selected.tasks.length && <p className="text-sm text-muted-foreground">暂无任务</p>}
                {selected.tasks.map(task => <article key={task.id} className="space-y-2 py-4 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-sm [overflow-wrap:anywhere]">{task.id}</span><Badge variant="outline" className={task.status === "failed" ? "text-destructive" : ""}>{taskLabels[task.status] || task.status}</Badge></div>
                  <p className="text-xs text-muted-foreground">开始：{time(task.createdAt)}</p><p className="text-xs text-muted-foreground">结束：{time(task.finishedAt)}</p>
                  {task.errorCode && <p className="text-xs text-destructive [overflow-wrap:anywhere]">{task.errorCode}</p>}
                </article>)}
              </div>}
            </div>
            <Pager label={tab === "messages" ? "消息" : "任务"} page={tab === "messages" ? selected.messagePage : selected.taskPage}
              pages={Math.ceil((tab === "messages" ? selected.messageCount : selected.taskCount) / selected.pageSize)} onChange={tab === "messages" ? setMessagePage : setTaskPage} />
          </>}
      </section>
    </div>
  </div>;
}
