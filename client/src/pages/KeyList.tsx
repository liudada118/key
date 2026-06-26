import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { BarChart3, Copy, Download, Loader2, Monitor, Pause, Play, RefreshCw, Search, ShieldX, Trash2, Unplug, History } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { Textarea } from "@/components/ui/textarea";

/** 状态 Badge 配置 */
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ISSUED: { label: "已签发", className: "bg-muted text-muted-foreground" },
  ACTIVATED: { label: "已激活", className: "bg-chart-2/10 text-chart-2 border-chart-2/30" },
  SUSPENDED: { label: "已暂停", className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  EXPIRED: { label: "已过期", className: "bg-chart-5/10 text-chart-5 border-chart-5/30" },
  RENEWED: { label: "已续期", className: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  REVOKED: { label: "已吊销", className: "bg-red-500/10 text-red-600 border-red-500/30" },
  TAMPERED: { label: "异常", className: "bg-red-600 text-white border-red-700 font-semibold" },
};

export default function KeyList() {
  const { user } = useAuth();
  const isAdmin = user?.role === "super_admin" || user?.role === "admin";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [genType, setGenType] = useState<string>("__all__");
  const [sensorType, setSensorType] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");

  // 设备详情弹窗状态
  const [devicesDialogOpen, setDevicesDialogOpen] = useState(false);
  const [devicesKeyId, setDevicesKeyId] = useState<number | null>(null);
  const [devicesKeyString, setDevicesKeyString] = useState("");
  const [devicesMaxDevices, setDevicesMaxDevices] = useState(0);

  // 生命周期操作弹窗状态
  const [lifecycleAction, setLifecycleAction] = useState<"suspend" | "restore" | "revoke" | "renew" | null>(null);
  const [lifecycleKeyId, setLifecycleKeyId] = useState<number | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [renewDays, setRenewDays] = useState<number>(30);

  // 状态历史弹窗
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyKeyId, setHistoryKeyId] = useState<number | null>(null);

  // 获取传感器分组用于 label 映射和筛选
  const { data: sensorGroups } = trpc.sensors.groups.useQuery();
  const sensorLabelMap = useMemo(() => {
    if (!sensorGroups) return {} as Record<string, string>;
    const map: Record<string, string> = { all: "全部类型" };
    for (const g of sensorGroups) {
      for (const item of g.items) {
        map[item.value] = item.label;
      }
    }
    return map;
  }, [sensorGroups]);

  const queryInput = useMemo(
    () => ({
      page,
      pageSize: 20,
      genType: genType === "__all__" ? undefined : (genType as "single" | "batch"),
      sensorType: sensorType === "__all__" ? undefined : sensorType,
      status: statusFilter === "__all__" ? undefined : statusFilter,
      search: search || undefined,
    }),
    [page, genType, sensorType, statusFilter, search]
  );

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.keys.list.useQuery(queryInput);

  // 设备列表查询
  const { data: devicesList, isLoading: devicesLoading } = trpc.keys.devices.useQuery(
    { keyId: devicesKeyId! },
    { enabled: devicesKeyId !== null && devicesDialogOpen }
  );

  // 状态历史查询
  const { data: statusHistoryData, isLoading: historyLoading } = trpc.keys.statusHistory.useQuery(
    { keyId: historyKeyId!, keyType: "online" },
    { enabled: historyKeyId !== null && historyDialogOpen }
  );

  const exportMutation = trpc.keys.export.useMutation({
    onSuccess: (result) => {
      if (typeof result === "string") {
        const blob = new Blob(["\uFEFF" + result], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `keys_export_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `keys_export_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast.success("导出成功");
    },
    onError: (err) => toast.error(err.message),
  });

  const unbindDeviceMutation = trpc.keys.unbindDevice.useMutation({
    onSuccess: () => {
      toast.success("设备已解绑");
      if (devicesKeyId) {
        utils.keys.devices.invalidate({ keyId: devicesKeyId });
      }
      utils.keys.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // 生命周期 mutations
  const suspendMutation = trpc.keys.suspend.useMutation({
    onSuccess: () => {
      toast.success("密钥已暂停");
      closeLifecycleDialog();
      utils.keys.list.invalidate();
      utils.keys.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const restoreMutation = trpc.keys.restore.useMutation({
    onSuccess: () => {
      toast.success("密钥已恢复");
      closeLifecycleDialog();
      utils.keys.list.invalidate();
      utils.keys.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeMutation = trpc.keys.revoke.useMutation({
    onSuccess: () => {
      toast.success("密钥已吊销");
      closeLifecycleDialog();
      utils.keys.list.invalidate();
      utils.keys.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const renewMutation = trpc.keys.renew.useMutation({
    onSuccess: () => {
      toast.success("密钥已续期");
      closeLifecycleDialog();
      utils.keys.list.invalidate();
      utils.keys.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = data ? Math.ceil(data.total / 20) : 0;

  const closeLifecycleDialog = () => {
    setLifecycleAction(null);
    setLifecycleKeyId(null);
    setLifecycleReason("");
    setRenewDays(30);
  };

  const handleLifecycleConfirm = () => {
    if (!lifecycleKeyId) return;
    switch (lifecycleAction) {
      case "suspend":
        suspendMutation.mutate({ keyId: lifecycleKeyId, reason: lifecycleReason });
        break;
      case "restore":
        restoreMutation.mutate({ keyId: lifecycleKeyId, reason: lifecycleReason });
        break;
      case "revoke":
        revokeMutation.mutate({ keyId: lifecycleKeyId, reason: lifecycleReason });
        break;
      case "renew":
        renewMutation.mutate({ keyId: lifecycleKeyId, additionalDays: renewDays });
        break;
    }
  };

  const handleOpenDevices = (key: { id: number; keyString: string; maxDevices: number }) => {
    setDevicesKeyId(key.id);
    setDevicesKeyString(key.keyString);
    setDevicesMaxDevices(key.maxDevices);
    setDevicesDialogOpen(true);
  };

  /** 将逗号分隔的传感器类型转为标签显示 */
  const renderSensorTypes = (sensorTypeStr: string) => {
    if (sensorTypeStr === "all") {
      return (
        <Badge variant="default" className="text-[10px]">
          全部类型
        </Badge>
      );
    }
    const types = sensorTypeStr.split(",").filter(Boolean);
    if (types.length === 1) {
      return (
        <span className="text-sm text-foreground">
          {sensorLabelMap[types[0]] || types[0]}
        </span>
      );
    }
    const displayTypes = types.slice(0, 2);
    const remaining = types.length - 2;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-wrap gap-0.5 cursor-help">
            {displayTypes.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] h-4 px-1">
                {sensorLabelMap[t] || t}
              </Badge>
            ))}
            {remaining > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 px-1">
                +{remaining}
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px]">
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                {sensorLabelMap[t] || t}
              </Badge>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  /** 渲染状态 Badge */
  const renderStatus = (key: any) => {
    const status = key.status || (key.isActivated ? "ACTIVATED" : (key.expireTimestamp < Date.now() ? "EXPIRED" : "ISSUED"));
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.ISSUED;
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  /** 渲染行级操作按钮 */
  const renderActions = (key: any) => {
    const status = key.status || "ISSUED";
    return (
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => {
                copyText(key.keyString);
                toast.success("已复制");
              }}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>复制密钥</TooltipContent>
        </Tooltip>

        {/* 状态历史 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => {
                setHistoryKeyId(key.id);
                setHistoryDialogOpen(true);
              }}
            >
              <History className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>状态历史</TooltipContent>
        </Tooltip>

        {isAdmin && (
          <>
            {/* 暂停/恢复 */}
            {status === "SUSPENDED" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                    onClick={() => {
                      setLifecycleAction("restore");
                      setLifecycleKeyId(key.id);
                    }}
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>恢复密钥</TooltipContent>
              </Tooltip>
            ) : status !== "REVOKED" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-yellow-600 hover:text-yellow-700"
                    onClick={() => {
                      setLifecycleAction("suspend");
                      setLifecycleKeyId(key.id);
                    }}
                  >
                    <Pause className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>暂停密钥</TooltipContent>
              </Tooltip>
            ) : null}

            {/* 续期 */}
            {status !== "REVOKED" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700"
                    onClick={() => {
                      setLifecycleAction("renew");
                      setLifecycleKeyId(key.id);
                    }}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>续期</TooltipContent>
              </Tooltip>
            )}

            {/* 吊销 */}
            {status !== "REVOKED" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                    onClick={() => {
                      setLifecycleAction("revoke");
                      setLifecycleKeyId(key.id);
                    }}
                  >
                    <ShieldX className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>吊销密钥</TooltipContent>
              </Tooltip>
            )}
          </>
        )}

      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">密钥管理</h1>
          <p className="text-muted-foreground mt-1">查看和管理所有密钥</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportMutation.mutate({
                format: "csv",
                sensorType: sensorType === "__all__" ? undefined : sensorType,
              })
            }
            disabled={exportMutation.isPending}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportMutation.mutate({
                format: "json",
                sensorType: sensorType === "__all__" ? undefined : sensorType,
              })
            }
            disabled={exportMutation.isPending}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            JSON
          </Button>
        </div>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索密钥..."
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
            <Select value={genType} onValueChange={(v) => { setGenType(v); setPage(1); }}>
              <SelectTrigger className="w-[130px] bg-secondary/50">
                <SelectValue placeholder="生成方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部</SelectItem>
                <SelectItem value="single">单个生成</SelectItem>
                <SelectItem value="batch">批量生成</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sensorType} onValueChange={(v) => { setSensorType(v); setPage(1); }}>
              <SelectTrigger className="w-[140px] bg-secondary/50">
                <SelectValue placeholder="传感器" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部传感器</SelectItem>
                {sensorGroups?.map((group) => (
                  <div key={group.group}>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      {group.icon} {group.group}
                    </div>
                    {group.items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[130px] bg-secondary/50">
                <SelectValue placeholder="生命周期" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                <SelectItem value="ISSUED">已签发</SelectItem>
                <SelectItem value="ACTIVATED">已激活</SelectItem>
                <SelectItem value="SUSPENDED">已暂停</SelectItem>
                <SelectItem value="EXPIRED">已过期</SelectItem>
                <SelectItem value="RENEWED">已续期</SelectItem>
                <SelectItem value="REVOKED">已吊销</SelectItem>
                <SelectItem value="TAMPERED">异常</SelectItem>
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
              <BarChart3 className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">暂无密钥数据</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="text-muted-foreground w-[60px]">ID</TableHead>
                      <TableHead className="text-muted-foreground">密钥</TableHead>
                      <TableHead className="text-muted-foreground">类型</TableHead>
                      <TableHead className="text-muted-foreground">传感器</TableHead>
                      <TableHead className="text-muted-foreground">有效期</TableHead>
                      <TableHead className="text-muted-foreground">到期时间</TableHead>
                      <TableHead className="text-muted-foreground">设备</TableHead>
                      <TableHead className="text-muted-foreground">状态</TableHead>
                      <TableHead className="text-muted-foreground">客户</TableHead>
                      <TableHead className="text-muted-foreground">合同</TableHead>
                      <TableHead className="text-muted-foreground">创建者</TableHead>
                      <TableHead className="text-muted-foreground">创建时间</TableHead>
                      <TableHead className="text-muted-foreground w-32">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((key: any) => (
                      <TableRow key={key.id} className="border-border/30">
                        <TableCell className="font-mono text-xs text-muted-foreground">{key.id}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[180px] truncate text-foreground">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">{"****" + (key.keyString as string).slice(-6)}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[400px] break-all font-mono text-xs">
                              {key.keyString}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              key.batchId
                                ? "bg-chart-4/10 text-chart-4 border-chart-4/30"
                                : "bg-chart-3/10 text-chart-3 border-chart-3/30"
                            }
                          >
                            {key.batchId ? "批量" : "单个"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {renderSensorTypes(key.sensorType)}
                        </TableCell>
                        <TableCell className="text-sm text-foreground">{key.days}天</TableCell>
                        <TableCell className="text-sm text-foreground">
                          {new Date(key.expireTimestamp).toLocaleDateString("zh-CN")}
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleOpenDevices({ id: key.id, keyString: key.keyString, maxDevices: key.maxDevices ?? 1 })}
                                className="flex items-center gap-1 text-xs cursor-pointer hover:text-primary transition-colors"
                              >
                                <Monitor className="h-3 w-3" />
                                <span className="font-medium">
                                  {key.isActivated ? "已绑定" : "0"}/{key.maxDevices === 0 ? "∞" : key.maxDevices ?? 1}
                                </span>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>点击查看已绑定设备</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          {renderStatus(key)}
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {key.customerName
                            ? key.customerId
                              ? key.customerName
                              : `${key.customerName}（该客户已删除）`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {key.contractNo
                            ? key.contractId
                              ? key.contractNo
                              : `${key.contractNo}（该合同已删除）`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {key.createdByName || "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(key.createdAt).toLocaleDateString("zh-CN")}
                        </TableCell>
                        <TableCell>
                          {renderActions(key)}
                        </TableCell>
                      </TableRow>
                    ))}
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

      {/* 生命周期操作弹窗 */}
      <Dialog open={lifecycleAction !== null} onOpenChange={(open) => { if (!open) closeLifecycleDialog(); }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {lifecycleAction === "suspend" && "暂停密钥"}
              {lifecycleAction === "restore" && "恢复密钥"}
              {lifecycleAction === "revoke" && "吊销密钥"}
              {lifecycleAction === "renew" && "续期密钥"}
            </DialogTitle>
            <DialogDescription>
              {lifecycleAction === "suspend" && "暂停后密钥将无法使用，可随时恢复"}
              {lifecycleAction === "restore" && "恢复后密钥将重新可用"}
              {lifecycleAction === "revoke" && "吊销后密钥将永久作废，此操作不可逆！"}
              {lifecycleAction === "renew" && "为密钥延长有效期"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {lifecycleAction === "renew" ? (
              <div className="space-y-2">
                <Label>续期天数</Label>
                <Input
                  type="number"
                  min={1}
                  max={36500}
                  value={renewDays}
                  onChange={(e) => setRenewDays(Number(e.target.value))}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>原因说明</Label>
                <Textarea
                  placeholder={`请输入${lifecycleAction === "suspend" ? "暂停" : lifecycleAction === "restore" ? "恢复" : "吊销"}原因...`}
                  value={lifecycleReason}
                  onChange={(e) => setLifecycleReason(e.target.value)}
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeLifecycleDialog}>
              取消
            </Button>
            <Button
              variant={lifecycleAction === "revoke" ? "destructive" : "default"}
              onClick={handleLifecycleConfirm}
              disabled={
                (lifecycleAction !== "renew" && !lifecycleReason.trim()) ||
                (lifecycleAction === "renew" && renewDays < 1) ||
                suspendMutation.isPending || restoreMutation.isPending ||
                revokeMutation.isPending || renewMutation.isPending
              }
            >
              {(suspendMutation.isPending || restoreMutation.isPending || revokeMutation.isPending || renewMutation.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 状态历史弹窗 */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              状态变更历史
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 max-h-[400px] overflow-y-auto">
            {historyLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : !statusHistoryData?.length ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <History className="h-10 w-10 mb-2 opacity-20" />
                <p className="text-sm">暂无状态变更记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {statusHistoryData.map((record: any) => (
                  <div key={record.id} className="flex items-start gap-3 p-3 bg-secondary/30 rounded-lg border border-border/50">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        {record.fromStatus && (
                          <>
                            <Badge variant="outline" className={STATUS_CONFIG[record.fromStatus]?.className || ""}>
                              {STATUS_CONFIG[record.fromStatus]?.label || record.fromStatus}
                            </Badge>
                            <span className="text-muted-foreground">→</span>
                          </>
                        )}
                        <Badge variant="outline" className={STATUS_CONFIG[record.toStatus]?.className || ""}>
                          {STATUS_CONFIG[record.toStatus]?.label || record.toStatus}
                        </Badge>
                      </div>
                      {record.reason && (
                        <p className="text-xs text-muted-foreground">{record.reason}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>操作人：{record.actorName || "系统"}</span>
                        <span>{new Date(record.createdAt).toLocaleString("zh-CN")}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 设备绑定详情弹窗 */}
      <Dialog open={devicesDialogOpen} onOpenChange={setDevicesDialogOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              已绑定设备
            </DialogTitle>
            <DialogDescription>
              密钥：<span className="font-mono text-xs">{"****" + devicesKeyString.slice(-6)}</span>
              <br />
              设备限制：{devicesMaxDevices === 0 ? "不限制" : `最多 ${devicesMaxDevices} 台`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {devicesLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : !devicesList?.length ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Unplug className="h-10 w-10 mb-2 opacity-20" />
                <p className="text-sm">暂无绑定设备</p>
                <p className="text-xs mt-1">客户可通过密钥自助绑定设备</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {devicesList.map((device: any) => (
                  <div
                    key={device.id}
                    className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg border border-border/50"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-mono text-sm font-medium text-foreground truncate">
                          {device.deviceCode}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground pl-5">
                        {device.deviceName && <span>{device.deviceName}</span>}
                        <span>绑定时间：{new Date(device.boundAt).toLocaleString("zh-CN")}</span>
                        {device.boundIp && <span>IP：{device.boundIp}</span>}
                      </div>
                    </div>
                    {isAdmin && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0 ml-2"
                            onClick={() => {
                              if (devicesKeyId) {
                                unbindDeviceMutation.mutate({
                                  keyId: devicesKeyId,
                                  deviceId: device.id,
                                });
                              }
                            }}
                            disabled={unbindDeviceMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>解绑设备</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <p className="text-xs text-muted-foreground">
                已绑定 {devicesList?.length ?? 0} / {devicesMaxDevices === 0 ? "∞" : devicesMaxDevices} 台
              </p>
              <Button variant="outline" onClick={() => setDevicesDialogOpen(false)}>
                关闭
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
