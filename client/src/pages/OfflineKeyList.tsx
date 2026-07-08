import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  Copy,
  Download,
  Loader2,
  Search,
  Shield,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";

/* ============ 离线密钥状态判定 ============ */
function getStatusBadge(item: { status?: string; expireDate: number }) {
  const now = Date.now();
  if (item.status === "REVOKED") return { text: "已吊销", variant: "destructive" as const };
  if (item.status === "SUSPENDED") return { text: "已暂停", variant: "secondary" as const };
  if (item.expireDate < now) return { text: "已过期", variant: "outline" as const };
  const days = Math.ceil((item.expireDate - now) / (24 * 60 * 60 * 1000));
  return { text: `有效 · 剩${days}天`, variant: "default" as const };
}

/* ============ 离线密钥管理页 ============ */
export default function OfflineKeyList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  // 传感器 value→label 映射
  const { data: sensorGroups } = trpc.sensors.groups.useQuery();
  const sensorLabelMap = useMemo(() => {
    const map: Record<string, string> = { all: "全部类型" };
    for (const g of sensorGroups ?? []) {
      for (const item of g.items) map[item.value] = item.label;
    }
    return map;
  }, [sensorGroups]);

  const utils = trpc.useUtils();
  const { data: stats } = trpc.offlineKeys.stats.useQuery();
  const { data, isLoading } = trpc.offlineKeys.list.useQuery({
    page,
    pageSize: 10,
    search: search || undefined,
  });

  // 批量选择 + 删除
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<number[]>([]);

  const batchDeleteMutation = trpc.offlineKeys.batchDelete.useMutation({
    onSuccess: (r: { deleted: number }) => {
      toast.success(`已从列表移除 ${r.deleted} 个离线密钥`);
      setDeleteOpen(false);
      setDeleteIds([]);
      setSelectedIds([]);
      utils.offlineKeys.list.invalidate();
      utils.offlineKeys.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const pageIds: number[] = (data?.items ?? []).map((k: any) => k.id);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const toggleAll = () => {
    setSelectedIds(
      allChecked
        ? selectedIds.filter((id) => !pageIds.includes(id))
        : Array.from(new Set([...selectedIds, ...pageIds])),
    );
  };
  const toggleOne = (id: number) => {
    setSelectedIds(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    );
  };
  const openDelete = (ids: number[]) => {
    if (!ids.length) return;
    setDeleteIds(ids);
    setDeleteOpen(true);
  };

  const copyToClipboard = (text: string) => {
    copyText(text);
    toast.success("已复制到剪贴板");
  };

  const downloadAsFile = (code: string) => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `license_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("激活码文件已下载");
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          离线密钥管理
        </h1>
        <p className="text-muted-foreground mt-1">
          查看、搜索已生成的离线激活码（RSA 签名、无机器码、不联网验证）
        </p>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">离线密钥总数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* 列表 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">离线密钥列表</CardTitle>
            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8"
                  onClick={() => openDelete(selectedIds)}
                  disabled={batchDeleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  删除选中（{selectedIds.length}）
                </Button>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜索客户/备注..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 h-8 w-56 text-sm"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !data || !data.items.length ? (
            <div className="text-center py-8 text-muted-foreground">暂无离线密钥记录</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="全选本页" />
                      </TableHead>
                      <TableHead>传感器类型</TableHead>
                      <TableHead className="w-28">状态</TableHead>
                      <TableHead className="w-20">有效天数</TableHead>
                      <TableHead className="w-32">到期时间</TableHead>
                      <TableHead className="w-24">客户</TableHead>
                      <TableHead className="w-24">合同</TableHead>
                      <TableHead className="w-24">创建人</TableHead>
                      <TableHead className="w-32">创建时间</TableHead>
                      <TableHead className="w-20 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item: any) => {
                      const sensorTypesArr = item.sensorTypes === "all" ? [] : item.sensorTypes.split(",").filter(Boolean);
                      const st = getStatusBadge(item);
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(item.id)}
                              onCheckedChange={() => toggleOne(item.id)}
                              aria-label={`选择离线密钥 ${item.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {item.sensorTypes === "all" ? (
                                <Badge variant="default" className="text-[10px]">全部授权</Badge>
                              ) : (
                                <>
                                  {sensorTypesArr.slice(0, 3).map((t: string) => (
                                    <Badge key={t} variant="secondary" className="text-[10px]">
                                      {sensorLabelMap[t] || t}
                                    </Badge>
                                  ))}
                                  {sensorTypesArr.length > 3 && (
                                    <Badge variant="outline" className="text-[10px]">
                                      +{sensorTypesArr.length - 3}
                                    </Badge>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={st.variant} className="text-[10px] whitespace-nowrap">{st.text}</Badge>
                          </TableCell>
                          <TableCell>{item.days}天</TableCell>
                          <TableCell className="text-xs">
                            {new Date(item.expireDate).toLocaleDateString("zh-CN")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.customerName
                              ? item.customerId
                                ? item.customerName
                                : `${item.customerName}（该客户已删除）`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.contractNo
                              ? item.contractId
                                ? item.contractNo
                                : `${item.contractNo}（该合同已删除）`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-sm">{item.createdByName || "-"}</TableCell>
                          <TableCell className="text-xs">
                            {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                onClick={() => copyToClipboard(item.activationCode)}
                                title="复制激活码"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                onClick={() => downloadAsFile(item.activationCode)}
                                title="下载激活码"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => openDelete([item.id])}
                                title="删除（仅从列表移除）"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {data.total > data.pageSize && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">共 {data.total} 条记录</span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">{page}/{totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 删除确认弹窗（离线密钥：仅从列表移除，无法真正作废） */}
      <Dialog open={deleteOpen} onOpenChange={(open) => { if (!open) { setDeleteOpen(false); setDeleteIds([]); } }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>删除离线密钥</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                将从列表移除选中的 {deleteIds.length} 个离线密钥记录。
              </span>
              <span className="block text-destructive font-medium">
                注意：离线激活码由客户端离线（RSA 验签）校验，服务端<strong>无法使已发出的激活码失效</strong>——删除后该激活码在到期前仍可继续使用。
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); setDeleteIds([]); }}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => batchDeleteMutation.mutate({ ids: deleteIds })}
              disabled={batchDeleteMutation.isPending}
            >
              {batchDeleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              仍要删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
