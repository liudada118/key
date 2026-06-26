import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { trpc } from "@/lib/trpc";
import { ClipboardList, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const DEVICE_TYPE_LABELS: Record<string, string> = {
  foot: "脚垫",
  seat: "坐垫",
  dummy: "假人",
};

const TYPE_FILTERS: { value: "" | "foot" | "seat" | "dummy"; label: string }[] = [
  { value: "", label: "全部" },
  { value: "foot", label: "脚垫" },
  { value: "seat", label: "坐垫" },
  { value: "dummy", label: "假人" },
];

export default function DeviceCodeRecords() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<"" | "foot" | "seat" | "dummy">("");
  const pageSize = 20;

  const { data, isLoading, refetch } = trpc.deviceCodes.list.useQuery({
    page,
    pageSize,
    deviceType: typeFilter || undefined,
  });

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = trpc.deviceCodes.delete.useMutation({
    onSuccess: () => {
      toast.success("记录已删除");
      setDeleteOpen(false);
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">设备码管理</h1>
        <p className="text-muted-foreground mt-1">记录每一次设备码读取（成功/失败）及其关联合同</p>
      </div>

      {/* 类型筛选 */}
      <div className="flex gap-2">
        {TYPE_FILTERS.map((t) => (
          <Button
            key={t.value || "all"}
            variant={typeFilter === t.value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTypeFilter(t.value);
              setPage(1);
            }}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            读取记录
            {data && (
              <Badge variant="secondary" className="ml-2">
                共 {data.total} 条
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <div className="text-center py-12 text-muted-foreground">暂无读取记录</div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>类型</TableHead>
                      <TableHead>插槽</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>关联合同</TableHead>
                      <TableHead>操作人</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((rec) => (
                      <TableRow key={rec.id}>
                        <TableCell>
                          <Badge variant="outline">{DEVICE_TYPE_LABELS[rec.deviceType] || rec.deviceType}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{rec.slotLabel || rec.slot}</TableCell>
                        <TableCell className="font-mono text-xs">{rec.mac || "-"}</TableCell>
                        <TableCell>
                          {rec.success ? (
                            <Badge className="bg-chart-2/10 text-chart-2 border-chart-2/30" variant="outline">
                              成功
                            </Badge>
                          ) : (
                            <Badge className="bg-destructive/10 text-destructive border-destructive/30" variant="outline">
                              失败
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{rec.contractNo || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{rec.createdByName || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(rec.createdAt).toLocaleString("zh-CN", {
                            timeZone: "Asia/Shanghai",
                            hour12: false,
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => { setDeleteTarget(rec); setDeleteOpen(true); }}
                            disabled={deleteMutation.isPending}
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

      {/* 删除确认弹窗 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除记录</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除这条设备码读取记录吗？此操作不可恢复。
            </AlertDialogDescription>
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
