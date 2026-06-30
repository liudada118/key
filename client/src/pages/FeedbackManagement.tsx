import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { MessageSquare, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type FeedbackStatus = "pending" | "processing" | "resolved" | "closed";

const STATUS_META: Record<FeedbackStatus, { label: string; className: string }> = {
  pending: { label: "待处理", className: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  processing: { label: "处理中", className: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
  resolved: { label: "已解决", className: "bg-chart-2/10 text-chart-2 border-chart-2/30" },
  closed: { label: "已关闭", className: "bg-muted text-muted-foreground border-border" },
};

const STATUS_FILTERS: { value: "" | FeedbackStatus; label: string }[] = [
  { value: "", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "resolved", label: "已解决" },
  { value: "closed", label: "已关闭" },
];

const TYPE_FILTERS = ["全部", "功能建议", "问题反馈", "商务合作", "其他"];

const formatTime = (value: string | Date | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
    : "-";

export default function FeedbackManagement() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"" | FeedbackStatus>("");
  const [typeFilter, setTypeFilter] = useState("全部");
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const pageSize = 20;

  const { data, isLoading, refetch } = trpc.feedback.list.useQuery({
    page,
    pageSize,
    status: statusFilter || undefined,
    type: typeFilter === "全部" ? undefined : typeFilter,
    keyword: keyword || undefined,
  });
  const { data: stats, refetch: refetchStats } = trpc.feedback.stats.useQuery();

  const [detail, setDetail] = useState<any>(null);
  const [detailStatus, setDetailStatus] = useState<FeedbackStatus>("pending");
  const [detailRemark, setDetailRemark] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const refreshAll = () => {
    refetch();
    refetchStats();
  };

  const updateMutation = trpc.feedback.update.useMutation({
    onSuccess: () => {
      toast.success("已更新");
      setDetail(null);
      refreshAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.feedback.delete.useMutation({
    onSuccess: () => {
      toast.success("反馈已删除");
      setDeleteOpen(false);
      refreshAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const openDetail = (rec: any) => {
    setDetail(rec);
    setDetailStatus(rec.status);
    setDetailRemark(rec.remark || "");
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">反馈管理</h1>
        <p className="text-muted-foreground mt-1">接收并处理桌面端（Shroom Vision）用户提交的反馈</p>
      </div>

      {/* 状态统计卡片 */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "全部", value: stats.total, key: "" as const },
            { label: "待处理", value: stats.pending, key: "pending" as const },
            { label: "处理中", value: stats.processing, key: "processing" as const },
            { label: "已解决", value: stats.resolved, key: "resolved" as const },
            { label: "已关闭", value: stats.closed, key: "closed" as const },
          ].map((card) => (
            <button
              key={card.label}
              onClick={() => { setStatusFilter(card.key); setPage(1); }}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                statusFilter === card.key ? "border-primary bg-accent" : "border-border"
              }`}
            >
              <div className="text-2xl font-semibold">{card.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{card.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s.value || "all"}
            variant={statusFilter === s.value ? "default" : "outline"}
            size="sm"
            onClick={() => { setStatusFilter(s.value); setPage(1); }}
          >
            {s.label}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {TYPE_FILTERS.map((t) => (
          <Button
            key={t}
            variant={typeFilter === t ? "default" : "outline"}
            size="sm"
            onClick={() => { setTypeFilter(t); setPage(1); }}
          >
            {t}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          <input
            className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            placeholder="搜索内容 / 联系方式"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setKeyword(keywordInput.trim()); setPage(1); } }}
          />
          <Button size="sm" variant="outline" onClick={() => { setKeyword(keywordInput.trim()); setPage(1); }}>
            搜索
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            反馈列表
            {data && (
              <Badge variant="secondary" className="ml-2">共 {data.total} 条</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <div className="text-center py-12 text-muted-foreground">暂无反馈</div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">类型</TableHead>
                      <TableHead>内容</TableHead>
                      <TableHead className="w-40">联系方式</TableHead>
                      <TableHead className="w-24">状态</TableHead>
                      <TableHead className="w-44">提交时间</TableHead>
                      <TableHead className="w-28 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((rec) => (
                      <TableRow key={rec.id} className="cursor-pointer" onClick={() => openDetail(rec)}>
                        <TableCell>
                          <Badge variant="outline">{rec.type}</Badge>
                        </TableCell>
                        <TableCell className="max-w-md truncate text-sm">{rec.content}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{rec.contact || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_META[rec.status as FeedbackStatus]?.className}>
                            {STATUS_META[rec.status as FeedbackStatus]?.label || rec.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatTime(rec.createdAt)}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openDetail(rec)}>
                            处理
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => { setDeleteTarget(rec); setDeleteOpen(true); }}
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">第 {page} / {totalPages} 页</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      上一页
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 详情 / 处理弹窗 */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>反馈详情</DialogTitle>
            <DialogDescription>查看完整内容并更新处理状态</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">类型：</span>{detail.type}</div>
                <div><span className="text-muted-foreground">来源：</span>{detail.source || "-"}</div>
                <div><span className="text-muted-foreground">方案：</span>{detail.solution || "-"}</div>
                <div><span className="text-muted-foreground">版本：</span>{detail.appVersion || "-"}</div>
                <div><span className="text-muted-foreground">平台：</span>{detail.platform || "-"}</div>
                <div><span className="text-muted-foreground">密钥尾段：</span>{detail.licenseKeyTail || "-"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">联系方式：</span>{detail.contact || "-"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">提交时间：</span>{formatTime(detail.createdAt)}</div>
              </div>

              <div>
                <div className="mb-1.5 text-sm text-muted-foreground">反馈内容</div>
                <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words">
                  {detail.content}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-sm text-muted-foreground">处理状态</div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STATUS_META) as FeedbackStatus[]).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={detailStatus === s ? "default" : "outline"}
                      onClick={() => setDetailStatus(s)}
                    >
                      {STATUS_META[s].label}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-sm text-muted-foreground">处理备注</div>
                <Textarea
                  rows={3}
                  placeholder="填写处理说明（选填）"
                  value={detailRemark}
                  onChange={(e) => setDetailRemark(e.target.value)}
                />
              </div>

              {detail.handledByName && (
                <p className="text-xs text-muted-foreground">
                  上次处理：{detail.handledByName} · {formatTime(detail.handledAt)}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>取消</Button>
            <Button
              disabled={updateMutation.isPending}
              onClick={() =>
                detail &&
                updateMutation.mutate({ id: detail.id, status: detailStatus, remark: detailRemark })
              }
            >
              {updateMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除反馈</AlertDialogTitle>
            <AlertDialogDescription>确定删除这条反馈吗？此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
