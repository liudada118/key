import { useState } from "react";
import { BusinessUnitFilter } from "@/components/BusinessUnitFilter";
import { DashboardBreakdown, DashboardMetrics, DashboardState } from "@/components/OperationsDashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const [businessUnit, setBusinessUnit] = useState("");
  const [view, setView] = useState("dashboard");
  const [issuance, setIssuance] = useState<"with" | "without">();
  const utils = trpc.useUtils();
  const { data, error, isLoading, isFetching, refetch } = trpc.contracts.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    status: statusFilter || undefined,
    source: "feishu",
    businessUnit: businessUnit || undefined,
    issuance,
  }, { enabled: view === "details" });
  const dashboard = trpc.contracts.dashboard.useQuery({ businessUnit: businessUnit || undefined });
  const drill = (status = "", next?: typeof issuance) => { setStatusFilter(status); setIssuance(next); setPage(1); setView("details"); };

  const items = data?.items ?? [];
  const sourceError = data && "error" in data ? data.error : undefined;
  const errorMessage = error?.message || sourceError;

  const selectStatus = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">合同管理</h1>
            <Badge variant="outline" className="gap-1">
              <Cloud className="h-3.5 w-3.5" />
              飞书多维表格
            </Badge>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => { void utils.contracts.invalidate(); }}
          disabled={isFetching || dashboard.isFetching}
          aria-label="刷新飞书合同"
          className="h-11"
        >
          <RefreshCw key="icon" aria-hidden="true" className={`h-4 w-4${isFetching ? " animate-spin motion-reduce:animate-none" : ""}`} />
          刷新
        </Button>
      </div>

      <Tabs value={view} onValueChange={setView}><TabsList className="h-11" aria-label="合同视图"><TabsTrigger value="dashboard" id="contract-dashboard-tab" aria-controls="contract-dashboard">合同看板</TabsTrigger><TabsTrigger value="details" id="contract-details-tab" aria-controls="contract-details">合同明细</TabsTrigger></TabsList></Tabs>

      <div className="flex flex-wrap items-end gap-4 border-y py-4">
        <BusinessUnitFilter value={businessUnit} onChange={value => { setBusinessUnit(value); setPage(1); setStatusFilter(""); setIssuance(undefined); }} />
        {view === "details" && <div className="min-w-0 space-y-2">
          <div className="text-sm font-medium">合同状态</div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={statusFilter === "" ? "default" : "outline"}
              size="sm"
              className="h-11"
              onClick={() => selectStatus("")}
              aria-pressed={statusFilter === ""}
            >
              全部
            </Button>
            {Object.entries(STATUS_MAP).map(([key, { label }]) => (
              <Button
                key={key}
                variant={statusFilter === key ? "default" : "outline"}
                size="sm"
                className="h-11"
                onClick={() => selectStatus(key)}
                aria-pressed={statusFilter === key}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>}
        {view === "details" && <div className="space-y-2"><Label htmlFor="contract-issuance">在线开钥进度</Label><select id="contract-issuance" className="block h-11 rounded-md border bg-background px-3 text-sm" value={issuance || ""} onChange={e => { setIssuance(e.target.value as typeof issuance || undefined); setPage(1); }}><option value="">全部合同</option><option value="with">已生成在线密钥</option><option value="without">未生成在线密钥</option></select></div>}
      </div>

      {view === "details" && errorMessage && (
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

      {view === "dashboard" && <div id="contract-dashboard" role="tabpanel" aria-labelledby="contract-dashboard-tab" className="space-y-5">
        <DashboardState loading={dashboard.isPending} error={dashboard.error?.message} onRetry={() => void dashboard.refetch()}>
          {dashboard.data && <>
            <DashboardMetrics items={[
              { label: "合同总数", value: dashboard.data.total, note: "按合同编号去重 · 当前事业部", onClick: () => drill() },
              { label: "生效中合同", value: dashboard.data.active, note: "合同状态为生效中", tone: 2, onClick: () => drill("ACTIVE") },
              { label: "已开钥合同", value: dashboard.data.issued, note: "已有在线密钥历史生成记录", onClick: () => drill("", "with") },
              { label: "待开钥合同", value: dashboard.data.waiting, note: "生效中且未生成在线密钥", tone: 3, onClick: () => drill("ACTIVE", "without") },
            ]} />
            <div className="grid min-w-0 gap-x-8 border-b lg:grid-cols-2">
              <DashboardBreakdown title="合同状态分布" rows={dashboard.data.total ? Object.entries(STATUS_MAP).map(([id, item], i) => ({ id, label: item.label, value: dashboard.data.statuses[id] || 0, tone: [3, 2, 5, 1][i], onClick: () => drill(id) })) : []} />
              <DashboardBreakdown title="事业部合同分布" rows={dashboard.data.departments.slice(0, 8).map(row => ({ id: row.name, label: row.name, value: row.value, note: `已开钥 ${row.issued} 份 / ${row.value} 份`, onClick: row.name === "待匹配部门" ? undefined : () => { setBusinessUnit(row.name); drill(); } }))} note="展示前 8 个事业部；在线开钥记录包含已吊销记录，不表示当前可用密钥。" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4 text-sm"><p>部门待匹配 <strong className="tabular-nums">{dashboard.data.unmatched}</strong> 份</p><Button variant="outline" className="h-11" onClick={() => drill("ACTIVE", "without")}>查看待开钥合同</Button></div>
          </>}
        </DashboardState>
      </div>}

      {view === "details" && <section id="contract-details" role="tabpanel" aria-labelledby="contract-details-tab" className="min-w-0 space-y-4">
      <h2 className="text-base font-semibold">合同明细 <span className="ml-2 text-sm font-normal text-muted-foreground">{data ? `${data.total} 份` : ""}</span></h2>
      <Card className="min-w-0 rounded-none border-0 bg-transparent shadow-none">
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>合同编号</TableHead>
                <TableHead>事业部</TableHead>
                <TableHead>提交人</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>已生成在线密钥</TableHead>
                <TableHead>有效期</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className="font-mono text-sm">{contract.contractNo}</TableCell>
                  <TableCell>
                    {"businessUnit" in contract ? contract.businessUnit || (
                      <span className="text-xs text-muted-foreground" title="未匹配到唯一的系统所属部门">待匹配部门</span>
                    ) : "-"}
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
      </section>}
    </div>
  );
}
