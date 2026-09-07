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
import { Download, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type SdkRequestStatus = "new" | "contacted" | "closed";

const STATUS_META: Record<SdkRequestStatus, { label: string; className: string }> = {
  new: { label: "待联系", className: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  contacted: { label: "已联系", className: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
  closed: { label: "已关闭", className: "bg-muted text-muted-foreground border-border" },
};

const STATUS_FILTERS: { value: "" | SdkRequestStatus; label: string }[] = [
  { value: "", label: "全部" },
  { value: "new", label: "待联系" },
  { value: "contacted", label: "已联系" },
  { value: "closed", label: "已关闭" },
];

const formatTime = (value: string | Date | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
    : "-";

export default function SdkRequestManagement() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"" | SdkRequestStatus>("");
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const pageSize = 20;

  const { data, isLoading, refetch } = trpc.sdkRequests.list.useQuery({
    page,
    pageSize,
    status: statusFilter || undefined,
    keyword: keyword || undefined,
  });
  const { data: stats, refetch: refetchStats } = trpc.sdkRequests.stats.useQuery();

  const [detail, setDetail] = useState<any>(null);
  const [detailStatus, setDetailStatus] = useState<SdkRequestStatus>("new");
  const [detailRemark, setDetailRemark] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const refreshAll = () => {
    refetch();
    refetchStats();
  };

  const updateMutation = trpc.sdkRequests.update.useMutation({
    onSuccess: () => {
      toast.success("已更新");
      setDetail(null);
      refreshAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.sdkRequests.delete.useMutation({
    onSuccess: () => {
      toast.success("记录已删除");
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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">SDK 获取</h1>
        <p className="text-muted-foreground mt-1">
          开发者站点点「获取 SDK」时留下的资料。这里只是登记，对方填完当场就下载了，不需要审批。
        </p>
      </div>

      {/* 状态统计卡片 */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "全部", value: stats.total, key: "" as const },
            { label: "待联系", value: stats.new, key: "new" as const },
            { label: "已联系", value: stats.contacted, key: "contacted" as const },
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
        <div className="ml-auto flex gap-2">
          <input
            className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            placeholder="搜索姓名 / 手机 / 邮箱 / 公司"
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
            <Download className="h-5 w-5" />
            获取记录
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
            <div className="text-center py-12 text-muted-foreground">暂无记录</div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">姓名</TableHead>
                      <TableHead className="w-36">手机</TableHead>
                      <TableHead className="w-52">邮箱</TableHead>
                      <TableHead>公司 / 学校</TableHead>
                      <TableHead className="w-24">来源</TableHead>
                      <TableHead className="w-24">状态</TableHead>
                      <TableHead className="w-44">提交时间</TableHead>
                      <TableHead className="w-28 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((rec) => (
                      <TableRow key={rec.id} className="cursor-pointer" onClick={() => openDetail(rec)}>
                        <TableCell className="font-medium">{rec.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{rec.phone || "-"}</TableCell>
                        <TableCell className="max-w-52 truncate text-sm text-muted-foreground">{rec.email || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm">{rec.organization || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{rec.source}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_META[rec.status as SdkRequestStatus]?.className}>
                            {STATUS_META[rec.status as SdkRequestStatus]?.label || rec.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatTime(rec.createdAt)}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openDetail(rec)}>
                            跟进
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

      {/* 详情 / 跟进弹窗 */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>获取记录详情</DialogTitle>
            <DialogDescription>查看联系资料并更新跟进状态</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">姓名：</span>{detail.name}</div>
                <div><span className="text-muted-foreground">手机：</span>{detail.phone || "-"}</div>
                <div className="col-span-2 break-all"><span className="text-muted-foreground">邮箱：</span>{detail.email || "-"}</div>
                <div className="col-span-2"><span className="text-muted-foreground">公司 / 学校：</span>{detail.organization || "-"}</div>
                <div><span className="text-muted-foreground">来源：</span>{detail.source || "-"}</div>
                <div><span className="text-muted-foreground">SDK 版本：</span>{detail.sdkVersion || "-"}</div>
                <div><span className="text-muted-foreground">IP：</span>{detail.ipAddress || "-"}</div>
                <div><span className="text-muted-foreground">提交时间：</span>{formatTime(detail.createdAt)}</div>
                {detail.referer && (
                  <div className="col-span-2 break-all text-xs">
                    <span className="text-muted-foreground">来源页面：</span>{detail.referer}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1.5 text-sm text-muted-foreground">跟进状态</div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STATUS_META) as SdkRequestStatus[]).map((s) => (
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
                <div className="mb-1.5 text-sm text-muted-foreground">跟进备注</div>
                <Textarea
                  rows={3}
                  placeholder="填写跟进说明（选填）"
                  value={detailRemark}
                  onChange={(e) => setDetailRemark(e.target.value)}
                />
              </div>

              {detail.handledByName && (
                <p className="text-xs text-muted-foreground">
                  上次跟进：{detail.handledByName} · {formatTime(detail.handledAt)}
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
            <AlertDialogTitle>删除记录</AlertDialogTitle>
            <AlertDialogDescription>确定删除这条获取记录吗？此操作不可恢复。</AlertDialogDescription>
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
