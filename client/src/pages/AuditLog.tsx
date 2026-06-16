import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { FileText, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";

/** 操作类型配置 */
const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  CREATE: { label: "创建", className: "bg-green-500/10 text-green-600 border-green-500/30" },
  ACTIVATE: { label: "激活", className: "bg-chart-2/10 text-chart-2 border-chart-2/30" },
  SUSPEND: { label: "暂停", className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  RESTORE: { label: "恢复", className: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  REVOKE: { label: "吊销", className: "bg-red-500/10 text-red-600 border-red-500/30" },
  RENEW: { label: "续期", className: "bg-purple-500/10 text-purple-600 border-purple-500/30" },
  UNBIND: { label: "解绑", className: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  EXPORT: { label: "导出", className: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30" },
  LOGIN: { label: "登录", className: "bg-chart-1/10 text-chart-1 border-chart-1/30" },
  LOGOUT: { label: "登出", className: "bg-muted text-muted-foreground" },
  DELETE: { label: "删除", className: "bg-red-500/10 text-red-600 border-red-500/30" },
  UPDATE: { label: "更新", className: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
};

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("__all__");
  const [resourceFilter, setResourceFilter] = useState<string>("__all__");

  const queryInput = useMemo(
    () => ({
      page,
      pageSize: 30,
      action: actionFilter === "__all__" ? undefined : actionFilter,
      resourceType: resourceFilter === "__all__" ? undefined : resourceFilter,
      search: search || undefined,
    }),
    [page, actionFilter, resourceFilter, search]
  );

  const { data, isLoading } = trpc.audit.list.useQuery(queryInput);
  const totalPages = data ? Math.ceil(data.total / 30) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">审计日志</h1>
        <p className="text-muted-foreground mt-1">查看系统所有操作记录</p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索操作描述..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSearch(searchInput);
                      setPage(1);
                    }
                  }}
                  className="pl-9 bg-secondary/50"
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSearch(searchInput);
                  setPage(1);
                }}
              >
                搜索
              </Button>
            </div>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[130px] bg-secondary/50">
                <SelectValue placeholder="操作类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部操作</SelectItem>
                <SelectItem value="CREATE">创建</SelectItem>
                <SelectItem value="ACTIVATE">激活</SelectItem>
                <SelectItem value="SUSPEND">暂停</SelectItem>
                <SelectItem value="RESTORE">恢复</SelectItem>
                <SelectItem value="REVOKE">吊销</SelectItem>
                <SelectItem value="RENEW">续期</SelectItem>
                <SelectItem value="UNBIND">解绑</SelectItem>
                <SelectItem value="EXPORT">导出</SelectItem>
                <SelectItem value="LOGIN">登录</SelectItem>
              </SelectContent>
            </Select>
            <Select value={resourceFilter} onValueChange={(v) => { setResourceFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[130px] bg-secondary/50">
                <SelectValue placeholder="资源类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部资源</SelectItem>
                <SelectItem value="licenseKey">在线密钥</SelectItem>
                <SelectItem value="offlineKey">离线密钥</SelectItem>
                <SelectItem value="user">用户</SelectItem>
                <SelectItem value="customer">客户</SelectItem>
                <SelectItem value="session">会话</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !data?.items.length ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <FileText className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">暂无审计日志</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-muted-foreground w-[160px]">时间</TableHead>
                      <TableHead className="text-muted-foreground">操作人</TableHead>
                      <TableHead className="text-muted-foreground">操作</TableHead>
                      <TableHead className="text-muted-foreground">资源类型</TableHead>
                      <TableHead className="text-muted-foreground">描述</TableHead>
                      <TableHead className="text-muted-foreground">IP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((log: any) => {
                      const actionCfg = ACTION_CONFIG[log.action] || { label: log.action, className: "bg-muted text-muted-foreground" };
                      return (
                        <TableRow key={log.id} className="border-border/30">
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString("zh-CN")}
                          </TableCell>
                          <TableCell className="text-sm text-foreground">
                            {log.userName || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={actionCfg.className}>
                              {actionCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-foreground">
                            {log.resourceType || "-"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground max-w-[300px] truncate">
                            {log.description || "-"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {log.ip || "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/30">
                <p className="text-sm text-muted-foreground">
                  共 {data.total} 条记录，第 {page}/{totalPages} 页
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
