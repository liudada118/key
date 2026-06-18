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
import { Edit, Ban, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  DRAFT: { label: "草稿", variant: "secondary" },
  ACTIVE: { label: "生效中", variant: "default" },
  EXPIRED: { label: "已过期", variant: "destructive" },
  TERMINATED: { label: "已终止", variant: "outline" },
};

const EMPTY_FORM = {
  contractNo: "",
  title: "",
  customerName: "",
  signDate: "",
  startDate: "",
  endDate: "",
  totalKeys: 0,
  remark: "",
};

const toDateInput = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : "");

export default function ContractManagement() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, refetch } = trpc.contracts.list.useQuery({
    page,
    pageSize: 20,
    status: statusFilter || undefined,
  });

  const createMutation = trpc.contracts.create.useMutation({
    onSuccess: () => {
      toast.success("合同创建成功");
      setShowDialog(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      refetch();
    },
    onError: () => toast.error("创建失败"),
  });

  const updateMutation = trpc.contracts.update.useMutation({
    onSuccess: () => {
      toast.success("合同更新成功");
      setShowDialog(false);
      setEditing(null);
      refetch();
    },
    onError: () => toast.error("更新失败"),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowDialog(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      contractNo: c.contractNo || "",
      title: c.title || "",
      customerName: c.customerName || "",
      signDate: toDateInput(c.signDate),
      startDate: toDateInput(c.startDate),
      endDate: toDateInput(c.endDate),
      totalKeys: c.totalKeys || 0,
      remark: c.remark || "",
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        title: form.title,
        customerName: form.customerName || null,
        signDate: form.signDate || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        totalKeys: form.totalKeys,
        remark: form.remark || null,
      });
    } else {
      createMutation.mutate(form);
    }
  };

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">合同管理</h1>
        <Button onClick={openCreate}>新建合同</Button>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2">
        <Button variant={statusFilter === "" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("")}>全部</Button>
        {Object.entries(STATUS_MAP).map(([key, { label }]) => (
          <Button key={key} variant={statusFilter === key ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(key)}>{label}</Button>
        ))}
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">合同总数</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data?.total ?? 0}</div></CardContent>
        </Card>
      </div>

      {/* 合同列表 */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>合同编号</TableHead>
                <TableHead>标题</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>密钥配额</TableHead>
                <TableHead>有效期</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className="font-mono text-sm">{contract.contractNo}</TableCell>
                  <TableCell>{contract.title}</TableCell>
                  <TableCell>{contract.customerName || "-"}</TableCell>
                  <TableCell>{contract.usedKeys}/{contract.totalKeys}</TableCell>
                  <TableCell className="text-sm">
                    {contract.startDate ? new Date(contract.startDate).toLocaleDateString("zh-CN") : "-"}
                    {" ~ "}
                    {contract.endDate ? new Date(contract.endDate).toLocaleDateString("zh-CN") : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_MAP[contract.status]?.variant || "secondary"}>
                      {STATUS_MAP[contract.status]?.label || contract.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => openEdit(contract)}>
                        <Edit className="h-3.5 w-3.5 mr-1" />
                        编辑
                      </Button>
                      {contract.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={() => updateMutation.mutate({ id: contract.id, status: "TERMINATED" })}
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" />
                          禁用
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateMutation.mutate({ id: contract.id, status: "ACTIVE" })}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          启用
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无合同数据</TableCell></TableRow>
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

      {/* 新建 / 编辑 合同对话框 */}
      <Dialog open={showDialog} onOpenChange={(v) => { setShowDialog(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑合同" : "新建合同"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">合同编号 *</label>
                <Input
                  value={form.contractNo}
                  onChange={(e) => setForm({ ...form, contractNo: e.target.value })}
                  placeholder="如 HT-2026-001"
                  disabled={!!editing}
                />
              </div>
              <div>
                <label className="text-sm font-medium">合同标题 *</label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="合同标题" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">客户名称</label>
                <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="客户名称" />
              </div>
              <div>
                <label className="text-sm font-medium">密钥总数</label>
                <Input type="number" value={form.totalKeys} onChange={(e) => setForm({ ...form, totalKeys: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">签订日期</label>
                <Input type="date" value={form.signDate} onChange={(e) => setForm({ ...form, signDate: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">生效日期</label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">结束日期</label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">备注</label>
              <Input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="备注信息" />
            </div>
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={!form.contractNo || !form.title || submitting}
            >
              {submitting ? "提交中..." : editing ? "保存修改" : "创建合同"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
