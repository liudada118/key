import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

/** Delete one uploaded object after confirmation; customer-local content is outside this operation. */
export function DeleteUploadedButton({ kind, sourceId, installationId, objectId, onDeleted }: {
  kind: "chat" | "usage"; sourceId: number; installationId: string; objectId: string; onDeleted?: () => void;
}) {
  const [message, setMessage] = useState("");
  const remove = trpc.uploadRetention.delete.useMutation();
  const utils = trpc.useUtils();
  /** Confirm the permanent remote deletion scope before sending a destructive request. */
  const act = async () => {
    if (!window.confirm(`删除服务器上的这${kind === "chat" ? "个会话" : "条统计"}？本机数据不受影响。相同${kind === "chat" ? "会话" : "事件"} ID 的旧队列不会再恢复此内容；新对话需新建会话。`)) return;
    try {
      await remove.mutateAsync({ kind, sourceId, installationId, objectId, confirmation: "DELETE_UPLOADED_DATA" });
      setMessage("服务器内容已删除，本机数据保留。"); await utils.invalidate(); onDeleted?.();
    } catch { setMessage("删除未完成，请刷新后重试。"); }
  };
  return <span className="inline-flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" className="h-11" disabled={remove.isPending} onClick={() => void act()}>删除服务器{kind === "chat" ? "会话" : "记录"}</Button>{message && <span role="status" className="text-xs">{message}</span>}</span>;
}

/** Explain retention and expose bounded preview, explicit cleanup, and content-free administrator audit. */
export default function UploadRetentionPanel() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const policy = trpc.uploadRetention.policy.useQuery();
  const audit = trpc.uploadRetention.audit.useQuery(undefined, { enabled: open });
  const cleanup = trpc.uploadRetention.cleanup.useMutation();
  const utils = trpc.useUtils();
  /** Preview first; each confirmed operation can delete at most 100 objects of each kind. */
  const act = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm("按180天会话/90天统计策略清理当前批次？每类最多100条。不会删除客户电脑上的数据，服务器操作不可恢复。")) return;
    try {
      const result = await cleanup.mutateAsync({ dryRun, limit: 100, ...(!dryRun ? { confirmation: "DELETE_EXPIRED_UPLOADS" as const } : {}) });
      setMessage(`${dryRun ? "预览" : "已清理"}：会话 ${result.chat}，统计 ${result.usage}。${result.hasMore ? "可能还有更多，可处理下一批。" : "当前批次处理完成。"}`);
      if (!dryRun) await utils.invalidate();
    } catch { setMessage("操作未完成，请核对服务端迁移和权限后重试。"); }
  };
  return <details className="rounded-lg border p-3 text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">上传数据保存与删除</summary>
    <p className="mt-3 text-muted-foreground">会话按最后成功接收快照起保留180天，统计按接收起保留90天。删除后仅保留防重放身份与审计，不保留正文或事件内容。已手动删除的同一会话 ID 不再接收。</p>
    <p className="mt-2">自动清理：{policy.isError ? "策略读取失败" : policy.data?.enabled ? "已由运维启用，每小时有界清理" : "未启用，需运维配置后生效"}。</p>
    <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" className="h-11" disabled={cleanup.isPending} onClick={() => void act(true)}>预览过期数据</Button>
      <Button variant="outline" size="sm" className="h-11" disabled={cleanup.isPending || !cleanup.data?.dryRun} onClick={() => void act(false)}>确认清理本批</Button></div>
    {message && <p role="status" className="mt-2">{message}</p>}
    <p className="mt-3 font-medium">最近删除审计</p>
    {audit.isError ? <p role="alert">审计读取失败，请刷新重试。</p> : <ul className="mt-2 max-h-40 overflow-auto text-xs">{audit.data?.map(row => <li key={row.id} className="py-1">{new Date(row.createdAt).toLocaleString("zh-CN")} · {row.actorId ? `管理员 #${row.actorId}` : "自动任务"} · {row.kind} · {row.affected} 条 · {row.action}</li>)}</ul>}
  </details>;
}
