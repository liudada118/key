import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { CircleAlert, Cloud, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "../lib/trpc";

const PAGE_SIZE = 20;

const STATUS_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT: { label: "草稿", variant: "secondary" },
  ACTIVE: { label: "生效中", variant: "default" },
  EXPIRED: { label: "已过期", variant: "destructive" },
  TERMINATED: { label: "已终止", variant: "outline" },
};

function formatDate(value: Date | string | number | null) {
  if (!value) return "-";

  const raw = typeof value === "string" && /^\d{10,13}$/.test(value)
    ? Number(value)
    : value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("zh-CN");
}

export default function ContractManagement() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const { data, error, isLoading, isFetching, refetch } = trpc.contracts.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter || undefined,
    source: "feishu",
  });

  const items = data?.items ?? [];
  const sourceError = data && "error" in data ? data.error : undefined;
  const errorMessage = error?.message || sourceError;

  const selectStatus = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">合同管理</h1>
            <Badge variant="outline" className="gap-1">
              <Cloud className="h-3.5 w-3.5" />
              飞书多维表格
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">合同数据由飞书统一维护</p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="刷新飞书合同"
        >
          <RefreshCw className={`h-4 w-4${isFetching ? " animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={statusFilter === "" ? "default" : "outline"}
          size="sm"
          onClick={() => selectStatus("")}
        >
          全部
        </Button>
        {Object.entries(STATUS_MAP).map(([key, { label }]) => (
          <Button
            key={key}
            variant={statusFilter === key ? "default" : "outline"}
            size="sm"
            onClick={() => selectStatus(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">飞书合同读取失败</p>
            <p className="mt-1 break-words text-foreground/70">{errorMessage}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">合同总数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.total ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>合同编号</TableHead>
                <TableHead>事业部</TableHead>
                <TableHead>提交人</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>已生成密钥</TableHead>
                <TableHead>有效期</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className="font-mono text-sm">{contract.contractNo}</TableCell>
                  <TableCell>
                    {"businessUnit" in contract ? contract.businessUnit || "-" : "-"}
                  </TableCell>
                  <TableCell>
                    {"submitter" in contract ? contract.submitter || "-" : "-"}
                  </TableCell>
                  <TableCell>{contract.customerName || "-"}</TableCell>
                  <TableCell>
                    {"generatedKeyCount" in contract ? contract.generatedKeyCount : 0}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDate(contract.startDate)}
                    {" ~ "}
                    {formatDate(contract.endDate)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_MAP[contract.status]?.variant || "secondary"}>
                      {STATUS_MAP[contract.status]?.label || contract.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在读取飞书合同
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !errorMessage && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    飞书表格中没有符合条件的合同
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1 || isFetching}
            onClick={() => setPage((current) => current - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            第 {page} 页 / 共 {Math.ceil(data.total / PAGE_SIZE)} 页
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page * PAGE_SIZE >= data.total || isFetching}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
