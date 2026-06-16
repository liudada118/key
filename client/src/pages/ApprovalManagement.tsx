import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const TYPE_MAP: Record<string, string> = {
  REVOKE: "吊销密钥",
  BATCH_GENERATE: "批量生成",
  DELETE: "删除操作",
  SUSPEND: "暂停密钥",
};

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING: { label: "待审批", variant: "default" },
  APPROVED: { label: "已通过", variant: "secondary" },
  REJECTED: { label: "已拒绝", variant: "destructive" },
};

export default function ApprovalManagement() {
  
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [rejectDialog, setRejectDialog] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data, refetch } = trpc.approvals.list.useQuery({
    page,
    pageSize: 20,
    status: statusFilter || undefined,
  });

  const { data: pendingCount } = trpc.approvals.pendingCount.useQuery();

  const approveMutation = trpc.approvals.approve.useMutation({
    onSuccess: () => {
      toast.success("审批已通过");
      refetch();
    },
    onError: (err) => toast.error("操作失败"),
  });

  const rejectMutation = trpc.approvals.reject.useMutation({
    onSuccess: () => {
      toast.success("审批已拒绝");
      setRejectDialog(null);
      setRejectReason("");
      refetch();
    },
    onError: (err) => toast.error("操作失败"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">审批管理</h1>
          {pendingCount !== undefined && pendingCount > 0 && (
            <Badge variant="destructive">{pendingCount} 待审批</Badge>
          )}
        </div>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2">
        <Button variant={statusFilter === "" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("")}>全部</Button>
        {Object.entries(STATUS_MAP).map(([key, { label }]) => (
          <Button key={key} variant={statusFilter === key ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(key)}>{label}</Button>
        ))}
      </div>

      {/* 审批列表 */}
      <Card>
        <CardHeader>
          <CardTitle>审批记录</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>申请人</TableHead>
                <TableHead>目标资源</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>审批人</TableHead>
                <TableHead>申请时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((approval) => (
                <TableRow key={approval.id}>
                  <TableCell>{approval.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TYPE_MAP[approval.type] || approval.type}</Badge>
                  </TableCell>
                  <TableCell>{approval.requesterName || "-"}</TableCell>
                  <TableCell className="text-sm">{approval.resourceType} #{approval.resourceId}</TableCell>
                  <TableCell className="text-sm max-w-[150px] truncate">{approval.reason || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_MAP[approval.status]?.variant || "secondary"}>
                      {STATUS_MAP[approval.status]?.label || approval.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{approval.approverName || "-"}</TableCell>
                  <TableCell className="text-sm">{new Date(approval.requestedAt).toLocaleString("zh-CN")}</TableCell>
                  <TableCell>
                    {approval.status === "PENDING" && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => approveMutation.mutate({ id: approval.id })}
                          disabled={approveMutation.isPending}
                        >
                          通过
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejectDialog(approval.id)}
                        >
                          拒绝
                        </Button>
                      </div>
                    )}
                    {approval.status === "REJECTED" && approval.rejectReason && (
                      <span className="text-xs text-red-600">原因: {approval.rejectReason}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">暂无审批记录</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 分页 */}
      {data && data.total > 20 && (
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</Button>
          <span className="text-sm leading-8">第 {page} 页 / 共 {Math.ceil(data.total / 20)} 页</span>
          <Button size="sm" variant="outline" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      )}

      {/* 拒绝原因弹窗 */}
      <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝审批</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">拒绝原因</label>
              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="请输入拒绝原因（可选）"
              />
            </div>
            <Button
              className="w-full"
              variant="destructive"
              onClick={() => rejectMutation.mutate({ id: rejectDialog!, reason: rejectReason || undefined })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "处理中..." : "确认拒绝"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
