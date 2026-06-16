import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  EXPIRY_WARNING: "密钥到期预警",
  HEARTBEAT_LOST: "心跳丢失",
  QUOTA_EXCEEDED: "配额超限",
  CONTRACT_EXPIRY: "合同到期",
};

const LEVEL_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  INFO: { label: "信息", variant: "secondary" },
  WARNING: { label: "警告", variant: "default" },
  CRITICAL: { label: "严重", variant: "destructive" },
};

export default function AlertCenter() {
  
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "unread" | "unresolved">("all");

  const { data, refetch } = trpc.alerts.list.useQuery({
    page,
    pageSize: 20,
    unreadOnly: filter === "unread" ? true : undefined,
    unresolvedOnly: filter === "unresolved" ? true : undefined,
  });

  const { data: unreadCount } = trpc.alerts.unreadCount.useQuery();

  const markReadMutation = trpc.alerts.markRead.useMutation({
    onSuccess: () => { refetch(); },
  });

  const resolveMutation = trpc.alerts.resolve.useMutation({
    onSuccess: () => {
      toast.success("告警已处理");
      refetch();
    },
  });

  const scanMutation = trpc.alerts.scanExpiring.useMutation({
    onSuccess: (result) => {
      toast.success(`扫描完成: 发现 ${result.expiringKeysCount} 个即将到期密钥，${result.expiringContractsCount} 个即将到期合同`);
      refetch();
    },
    onError: (err) => toast.error("扫描失败"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">告警中心</h1>
          {unreadCount !== undefined && unreadCount > 0 && (
            <Badge variant="destructive">{unreadCount} 未读</Badge>
          )}
        </div>
        <Button onClick={() => scanMutation.mutate({ daysBeforeExpiry: 7 })} disabled={scanMutation.isPending}>
          {scanMutation.isPending ? "扫描中..." : "手动扫描到期预警"}
        </Button>
      </div>

      {/* 筛选 */}
      <div className="flex gap-2">
        <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>全部</Button>
        <Button variant={filter === "unread" ? "default" : "outline"} size="sm" onClick={() => setFilter("unread")}>未读</Button>
        <Button variant={filter === "unresolved" ? "default" : "outline"} size="sm" onClick={() => setFilter("unresolved")}>未处理</Button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">告警总数</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data?.total ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">未读</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-orange-600">{unreadCount ?? 0}</div></CardContent>
        </Card>
      </div>

      {/* 告警列表 */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>级别</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>标题</TableHead>
                <TableHead>内容</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((alert) => (
                <TableRow key={alert.id} className={!alert.isRead ? "bg-orange-50" : ""}>
                  <TableCell>
                    <Badge variant={LEVEL_MAP[alert.level]?.variant || "secondary"}>
                      {LEVEL_MAP[alert.level]?.label || alert.level}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{TYPE_MAP[alert.type] || alert.type}</TableCell>
                  <TableCell className="font-medium">{alert.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{alert.content || "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {!alert.isRead && <Badge variant="outline">未读</Badge>}
                      {!alert.isResolved && <Badge variant="secondary">未处理</Badge>}
                      {alert.isResolved && <Badge variant="default">已处理</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{new Date(alert.createdAt).toLocaleString("zh-CN")}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {!alert.isRead && (
                        <Button size="sm" variant="ghost" onClick={() => markReadMutation.mutate({ id: alert.id })}>已读</Button>
                      )}
                      {!alert.isResolved && (
                        <Button size="sm" variant="outline" onClick={() => resolveMutation.mutate({ id: alert.id })}>处理</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无告警</TableCell></TableRow>
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
    </div>
  );
}
