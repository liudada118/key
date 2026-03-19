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
import { BarChart3, Copy, Download, Loader2, Pencil, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function KeyList() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [sensorType, setSensorType] = useState<string>("__all__");
  const [activated, setActivated] = useState<string>("__all__");

  // 更改密钥类型弹窗状态
  const [changeCategoryOpen, setChangeCategoryOpen] = useState(false);
  const [changeCategoryKey, setChangeCategoryKey] = useState<{
    id: number;
    keyString: string;
    category: string;
  } | null>(null);
  const [newCategory, setNewCategory] = useState<string>("");

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
      category: category === "__all__" ? undefined : category,
      sensorType: sensorType === "__all__" ? undefined : sensorType,
      isActivated: activated === "__all__" ? undefined : activated === "true",
      search: search || undefined,
    }),
    [page, category, sensorType, activated, search]
  );

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.keys.list.useQuery(queryInput);

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

  const changeCategoryMutation = trpc.keys.changeCategory.useMutation({
    onSuccess: () => {
      toast.success("密钥类型已更改");
      setChangeCategoryOpen(false);
      setChangeCategoryKey(null);
      utils.keys.list.invalidate();
      utils.keys.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = data ? Math.ceil(data.total / 20) : 0;

  const handleOpenChangeCategory = (key: { id: number; keyString: string; category: string }) => {
    setChangeCategoryKey(key);
    setNewCategory(key.category === "production" ? "rental" : "production");
    setChangeCategoryOpen(true);
  };

  const handleConfirmChangeCategory = () => {
    if (!changeCategoryKey || !newCategory) return;
    changeCategoryMutation.mutate({
      keyId: changeCategoryKey.id,
      category: newCategory as "production" | "rental",
    });
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
                category: category === "__all__" ? undefined : category,
                sensorType: sensorType === "__all__" ? undefined : sensorType,
                isActivated: activated === "__all__" ? undefined : activated === "true",
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
                category: category === "__all__" ? undefined : category,
                sensorType: sensorType === "__all__" ? undefined : sensorType,
                isActivated: activated === "__all__" ? undefined : activated === "true",
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
            <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
              <SelectTrigger className="w-[130px] bg-secondary/50">
                <SelectValue placeholder="密钥类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部类型</SelectItem>
                <SelectItem value="production">量产密钥</SelectItem>
                <SelectItem value="rental">在线租赁</SelectItem>
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
            <Select value={activated} onValueChange={(v) => { setActivated(v); setPage(1); }}>
              <SelectTrigger className="w-[120px] bg-secondary/50">
                <SelectValue placeholder="激活状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                <SelectItem value="true">已激活</SelectItem>
                <SelectItem value="false">未激活</SelectItem>
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
                      <TableHead className="text-muted-foreground">密钥</TableHead>
                      <TableHead className="text-muted-foreground">类型</TableHead>
                      <TableHead className="text-muted-foreground">传感器</TableHead>
                      <TableHead className="text-muted-foreground">有效期</TableHead>
                      <TableHead className="text-muted-foreground">到期时间</TableHead>
                      <TableHead className="text-muted-foreground">状态</TableHead>
                      <TableHead className="text-muted-foreground">客户</TableHead>
                      <TableHead className="text-muted-foreground">创建者</TableHead>
                      <TableHead className="text-muted-foreground">创建时间</TableHead>
                      <TableHead className="text-muted-foreground w-16">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((key) => {
                      const isExpired = key.expireTimestamp < Date.now();
                      return (
                        <TableRow key={key.id} className="border-border/30">
                          <TableCell className="font-mono text-xs max-w-[180px] truncate text-foreground">
                            {key.keyString}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                key.category === "production"
                                  ? "bg-chart-3/10 text-chart-3 border-chart-3/30"
                                  : "bg-chart-4/10 text-chart-4 border-chart-4/30"
                              }
                            >
                              {key.category === "production" ? "量产" : "租赁"}
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
                            {key.isActivated ? (
                              <Badge className="bg-chart-2/10 text-chart-2 border-chart-2/30" variant="outline">
                                已激活
                              </Badge>
                            ) : isExpired ? (
                              <Badge className="bg-chart-5/10 text-chart-5 border-chart-5/30" variant="outline">
                                已过期
                              </Badge>
                            ) : (
                              <Badge className="bg-muted text-muted-foreground" variant="outline">
                                未激活
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-foreground">
                            {key.customerName || "-"}
                          </TableCell>
                          <TableCell className="text-sm text-foreground">
                            {key.createdByName || "-"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(key.createdAt).toLocaleDateString("zh-CN")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0"
                                    onClick={() => {
                                      navigator.clipboard.writeText(key.keyString);
                                      toast.success("已复制");
                                    }}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>复制密钥</TooltipContent>
                              </Tooltip>
                              {isSuperAdmin && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => handleOpenChangeCategory(key)}
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>更改密钥类型</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
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

      {/* 更改密钥类型弹窗 */}
      <Dialog open={changeCategoryOpen} onOpenChange={setChangeCategoryOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>更改密钥类型</DialogTitle>
            <DialogDescription>
              将密钥类型从「{changeCategoryKey?.category === "production" ? "量产密钥" : "在线租赁密钥"}」更改为其他类型
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">密钥</Label>
              <p className="font-mono text-xs bg-muted p-2 rounded break-all">
                {changeCategoryKey?.keyString}
              </p>
            </div>
            <div className="space-y-2">
              <Label>当前类型</Label>
              <div>
                <Badge
                  variant="outline"
                  className={
                    changeCategoryKey?.category === "production"
                      ? "bg-chart-3/10 text-chart-3 border-chart-3/30"
                      : "bg-chart-4/10 text-chart-4 border-chart-4/30"
                  }
                >
                  {changeCategoryKey?.category === "production" ? "量产密钥" : "在线租赁密钥"}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <Label>更改为</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="选择新类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">量产密钥</SelectItem>
                  <SelectItem value="rental">在线租赁密钥</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeCategoryOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleConfirmChangeCategory}
              disabled={changeCategoryMutation.isPending || newCategory === changeCategoryKey?.category}
            >
              {changeCategoryMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              确认更改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
