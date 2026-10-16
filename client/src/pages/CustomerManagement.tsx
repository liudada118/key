import { useAuth } from "@/_core/hooks/useAuth";
import { BusinessUnitFilter } from "@/components/BusinessUnitFilter";
import { DashboardBreakdown, DashboardMetrics, DashboardState } from "@/components/OperationsDashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Building2,
  Edit,
  Loader2,
  Phone,
  Plus,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  User,
  Mail,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function CustomerManagement() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [businessUnit, setBusinessUnit] = useState("");
  const [view, setView] = useState("dashboard");
  const [coverage, setCoverage] = useState<"with" | "without" | "unmatched">();
  const [active, setActive] = useState<boolean>();
  const [showDialog, setShowDialog] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    remark: "",
  });

  const pageSize = 15;
  const utils = trpc.useUtils();

  const { data, isLoading, isFetching, error, refetch } = trpc.customers.list.useQuery({
    page,
    pageSize,
    search: search || undefined,
    businessUnit: businessUnit || undefined,
    coverage, isActive: active,
  }, { enabled: view === "details" });
  const dashboard = trpc.customers.dashboard.useQuery({ search: search || undefined, businessUnit: businessUnit || undefined });
  function drill(next?: typeof coverage, enabled?: boolean) { setCoverage(next); setActive(enabled); setPage(1); setView("details"); }

  const syncMutation = trpc.customers.syncFeishu.useMutation({
    onSuccess: async (result) => {
      setSearch("");
      setSearchInput("");
      setPage(1);
      await utils.customers.invalidate();
      toast.success(`同步完成：新增 ${result.created} 个客户，已有 ${result.existing} 个${result.skipped ? `，跳过 ${result.skipped} 条无效客户名称` : ""}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const createMutation = trpc.customers.create.useMutation({
    onSuccess: () => {
      toast.success("客户创建成功");
      setShowDialog(false);
      resetForm();
      void utils.customers.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.customers.update.useMutation({
    onSuccess: () => {
      toast.success("客户信息已更新");
      setShowDialog(false);
      resetForm();
      void utils.customers.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = trpc.customers.delete.useMutation({
    onSuccess: () => {
      toast.success("客户已删除");
      setDeleteOpen(false);
      void utils.customers.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => {
    setFormData({ name: "", contactPerson: "", phone: "", email: "", address: "", remark: "" });
    setEditingCustomer(null);
  };

  const openCreate = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEdit = (customer: any) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || "",
      contactPerson: customer.contactPerson || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      remark: customer.remark || "",
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error("客户名称不能为空");
      return;
    }
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleToggleActive = (customer: any) => {
    updateMutation.mutate({
      id: customer.id,
      isActive: !customer.isActive,
    });
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">客户管理</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="icon" className="size-11" title="刷新客户看板" aria-label="刷新客户看板" disabled={dashboard.isFetching || isFetching} onClick={() => { void utils.customers.invalidate(); void utils.contracts.businessUnits.invalidate(); }}><RefreshCw aria-hidden="true" className="size-4" /></Button>
          <Button variant="outline" className="h-11 gap-2" disabled={!user || syncMutation.isPending}
            aria-busy={syncMutation.isPending} onClick={() => syncMutation.mutate()}>
            <RefreshCw key="icon" aria-hidden="true" className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin motion-reduce:animate-none" : ""}`} />
            同步飞书客户
          </Button>
          <Button onClick={openCreate} className="h-11 gap-2">
            <Plus key="icon" aria-hidden="true" className="h-4 w-4" />
            添加客户
          </Button>
        </div>
      </div>

      {/* 搜索栏 */}
      <section className="border-y py-4" aria-label="客户筛选">
          <div className="flex flex-wrap items-end gap-3">
            <BusinessUnitFilter value={businessUnit} onChange={value => { setBusinessUnit(value); setPage(1); setCoverage(undefined); setActive(undefined); }} />
            <div className="min-w-0 flex-1 basis-64 space-y-2">
              <Label htmlFor="customer-search">客户搜索</Label>
              <div className="relative">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="customer-search"
                  placeholder="搜索客户名称、联系人、电话..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="h-11 pl-10"
                />
              </div>
            </div>
            <Button onClick={handleSearch} variant="secondary" className="h-11">
              搜索
            </Button>
            {search && (
              <Button
                variant="outline"
                className="h-11"
                onClick={() => {
                  setSearch("");
                  setSearchInput("");
                  setPage(1);
                }}
              >
                清除
              </Button>
            )}
          </div>
      </section>

      <Tabs value={view} onValueChange={setView}><TabsList className="h-11" aria-label="客户视图"><TabsTrigger value="dashboard" id="customer-dashboard-tab" aria-controls="customer-dashboard">客户看板</TabsTrigger><TabsTrigger value="details" id="customer-details-tab" aria-controls="customer-details">客户明细</TabsTrigger></TabsList></Tabs>
      {view === "dashboard" && <div id="customer-dashboard" role="tabpanel" aria-labelledby="customer-dashboard-tab" className="space-y-5">
        <DashboardState loading={dashboard.isPending} error={dashboard.error?.message} onRetry={() => void dashboard.refetch()}>
          {dashboard.data && <>
            {dashboard.data.contractMetadataError && <p role="alert" className="text-sm text-destructive">{dashboard.data.contractMetadataError}</p>}
            <DashboardMetrics items={[
              { label: "客户总数", value: dashboard.data.total, note: `启用 ${dashboard.data.active} 家 · 当前筛选范围`, onClick: () => drill() },
              { label: "已关联合同", value: dashboard.data.withContracts ?? "暂不可用", note: "至少关联一份可见合同的客户", onClick: dashboard.data.withContracts === null ? undefined : () => drill("with") },
              { label: "未关联合同", value: dashboard.data.withoutContracts ?? "暂不可用", note: "本地档案暂无可见合同", onClick: dashboard.data.withoutContracts === null ? undefined : () => drill("without") },
              { label: "部门待完善", value: dashboard.data.unmatched ?? "暂不可用", note: "至少一份合同尚未匹配部门", tone: 5, onClick: dashboard.data.unmatched === null ? undefined : () => drill("unmatched") },
            ]} />
            <div className="grid min-w-0 gap-x-8 border-b lg:grid-cols-2">
              <DashboardBreakdown title="客户合同覆盖" empty={dashboard.data.contractMetadataError ? "合同资料暂不可用" : "暂无客户"} rows={dashboard.data.total && dashboard.data.withContracts !== null ? [
                { id: "with", label: "已关联合同", value: dashboard.data.withContracts, tone: 2, onClick: () => drill("with") },
                { id: "without", label: "未关联合同", value: dashboard.data.withoutContracts!, tone: 3, onClick: () => drill("without") },
              ] : []} note={dashboard.data.withContracts !== null && dashboard.data.total ? `合同覆盖率 ${(dashboard.data.withContracts / dashboard.data.total * 100).toFixed(1)}%` : undefined} />
              <DashboardBreakdown title="事业部客户分布" rows={dashboard.data.departments.slice(0, 8).map(row => ({ id: row.name, label: row.name, value: row.value, onClick: () => { setBusinessUnit(row.name); drill(); } }))} note="客户按事业部分别去重；跨部门客户可重复计入。展示前 8 个事业部。" empty={dashboard.data.contractMetadataError ? "部门资料暂不可用" : "暂无已匹配部门"} />
            </div>
          </>}
        </DashboardState>
      </div>}

      {/* 客户列表 */}
      {view === "details" && <section id="customer-details" role="tabpanel" aria-labelledby="customer-details-tab" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-2"><Label htmlFor="customer-coverage">合同覆盖</Label><select id="customer-coverage" className="block h-11 rounded-md border bg-background px-3 text-sm" value={coverage || ""} onChange={e => { setCoverage(e.target.value as typeof coverage || undefined); setPage(1); }}><option value="">全部客户</option><option value="with">已关联合同</option><option value="without">未关联合同</option><option value="unmatched">部门待完善</option></select></div>
        <div className="space-y-2"><Label htmlFor="customer-active">客户状态</Label><select id="customer-active" className="block h-11 rounded-md border bg-background px-3 text-sm" value={active === undefined ? "" : String(active)} onChange={e => { setActive(e.target.value ? e.target.value === "true" : undefined); setPage(1); }}><option value="">全部状态</option><option value="true">启用</option><option value="false">禁用</option></select></div>
      </div>
      <Card className="min-w-0 rounded-none border-0 bg-transparent shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            客户列表
            {data && (
              <Badge variant="secondary" className="ml-2">
                共 {data.total} 个客户
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.contractMetadataError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-destructive">{data.contractMetadataError}</p>
              <Button variant="outline" className="h-11 gap-2" disabled={isFetching} aria-busy={isFetching} onClick={() => refetch()}>
                <RefreshCw key="icon" aria-hidden="true" className={`h-4 w-4 ${isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} />
                重试
              </Button>
            </div>
          )}
          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-6">
              <p className="text-sm text-destructive">客户读取失败：{error.message}</p>
              <Button variant="outline" onClick={() => refetch()}>重试</Button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>暂无客户数据</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table className="min-w-[1000px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>客户名称</TableHead>
                      <TableHead className="min-w-36">部门</TableHead>
                      <TableHead className="min-w-28">发起人</TableHead>
                      <TableHead>联系人</TableHead>
                      <TableHead>联系电话</TableHead>
                      <TableHead>邮箱</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell className="min-w-48 max-w-72 whitespace-normal break-words font-medium">{customer.name}</TableCell>
                        <TableCell className="max-w-56 whitespace-normal break-words">
                          {data.contractMetadataError ? <span className="text-muted-foreground">暂不可用</span> : (
                            <div className="space-y-1">
                              {customer.departmentNames.map(name => <div key={name}>{name}</div>)}
                              {customer.unmatchedDepartmentCount > 0 && (
                                <div className="text-muted-foreground" title={`${customer.unmatchedDepartmentCount} 份合同未匹配到唯一的系统所属部门`}>待匹配部门</div>
                              )}
                              {customer.contractCount === 0 && <span className="text-muted-foreground">-</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-40 whitespace-normal break-words">
                          {data.contractMetadataError ? <span className="text-muted-foreground">暂不可用</span> : (
                            <div className="space-y-1">
                              {customer.initiatorNames.map(name => <div key={name}>{name}</div>)}
                              {customer.missingInitiatorCount > 0 && <div className="text-muted-foreground">待补发起人</div>}
                              {customer.contractCount === 0 && <span className="text-muted-foreground">-</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{customer.contactPerson || "-"}</TableCell>
                        <TableCell className="font-mono text-sm">{customer.phone || "-"}</TableCell>
                        <TableCell className="text-sm">{customer.email || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={customer.isActive ? "default" : "secondary"}>
                            {customer.isActive ? "启用" : "禁用"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(customer.createdAt).toLocaleDateString("zh-CN")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(customer)}
                              className="gap-1"
                            >
                              <Edit key="icon" aria-hidden="true" className="h-3.5 w-3.5" />
                              编辑
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleActive(customer)}
                              className="gap-1"
                            >
                              {customer.isActive ? (
                                <ToggleRight key="icon" aria-hidden="true" className="h-3.5 w-3.5" />
                              ) : (
                                <ToggleLeft key="icon" aria-hidden="true" className="h-3.5 w-3.5" />
                              )}
                              {customer.isActive ? "禁用" : "启用"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setDeleteTarget(customer); setDeleteOpen(true); }}
                              disabled={deleteMutation.isPending}
                              className="gap-1 text-destructive hover:text-destructive"
                            >
                              <Trash2 key="icon" aria-hidden="true" className="h-3.5 w-3.5" />
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    第 {page} / {totalPages} 页
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </section>}

      {/* 删除确认弹窗 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除客户</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.keyCount > 0
                ? "当前客户存在关联密钥！请先吊销密钥后再删除客户。"
                : `确定删除客户「${deleteTarget?.name}」吗？此操作不可恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {!(deleteTarget?.keyCount > 0) && (
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
              >
                删除
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 创建/编辑客户对话框 */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? "编辑客户" : "添加客户"}</DialogTitle>
            <DialogDescription>
              {editingCustomer ? "修改客户信息" : "填写客户信息，创建新客户"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name" className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                客户名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="输入客户名称或公司名"
                maxLength={50}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contactPerson" className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  联系人
                </Label>
                <Input
                  id="contactPerson"
                  placeholder="联系人姓名"
                  maxLength={20}
                  value={formData.contactPerson}
                  onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone" className="flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  联系电话
                </Label>
                <Input
                  id="phone"
                  placeholder="手机号或座机"
                  maxLength={20}
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email" className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                邮箱
              </Label>
              <Input
                id="email"
                placeholder="客户邮箱"
                maxLength={100}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address" className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                地址
              </Label>
              <Input
                id="address"
                placeholder="客户地址"
                maxLength={200}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="remark">备注</Label>
              <Textarea
                id="remark"
                placeholder="备注信息（可选）"
                maxLength={200}
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 key="icon" aria-hidden="true" className="h-4 w-4 animate-spin mr-2" />
              )}
              {editingCustomer ? "保存修改" : "创建客户"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
