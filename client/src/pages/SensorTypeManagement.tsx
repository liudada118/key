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
import {
  Loader2,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function SensorTypeManagement() {
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupIcon, setNewGroupIcon] = useState("");
  const [customGroup, setCustomGroup] = useState(false);
  const [filterGroup, setFilterGroup] = useState<string>("__all__");
  const [showDisabled, setShowDisabled] = useState(false);

  const utils = trpc.useUtils();
  const { data: allSensors, isLoading } = trpc.sensors.all.useQuery();
  const { data: sensorGroups } = trpc.sensors.groups.useQuery();

  // 获取所有分组名称
  const groupNames = useMemo(() => {
    if (!allSensors) return [];
    const names = new Set<string>();
    for (const s of allSensors) {
      names.add(s.groupName);
    }
    return Array.from(names);
  }, [allSensors]);

  // 按分组过滤
  const filteredSensors = useMemo(() => {
    if (!allSensors) return [];
    let list = allSensors;
    if (filterGroup !== "__all__") {
      list = list.filter((s) => s.groupName === filterGroup);
    }
    if (!showDisabled) {
      list = list.filter((s) => s.isActive);
    }
    return list;
  }, [allSensors, filterGroup, showDisabled]);

  // 按分组聚合显示
  const groupedSensors = useMemo(() => {
    const map = new Map<string, typeof filteredSensors>();
    for (const s of filteredSensors) {
      if (!map.has(s.groupName)) map.set(s.groupName, []);
      map.get(s.groupName)!.push(s);
    }
    return Array.from(map.entries());
  }, [filteredSensors]);

  const addMutation = trpc.sensors.add.useMutation({
    onSuccess: () => {
      toast.success("传感器类型已添加");
      setAddOpen(false);
      resetForm();
      utils.sensors.all.invalidate();
      utils.sensors.groups.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.sensors.delete.useMutation({
    onSuccess: () => {
      toast.success("传感器类型已禁用");
      utils.sensors.all.invalidate();
      utils.sensors.groups.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const restoreMutation = trpc.sensors.restore.useMutation({
    onSuccess: () => {
      toast.success("传感器类型已恢复");
      utils.sensors.all.invalidate();
      utils.sensors.groups.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => {
    setNewLabel("");
    setNewValue("");
    setNewGroupName("");
    setNewGroupIcon("");
    setCustomGroup(false);
  };

  const handleAdd = () => {
    if (!newLabel || !newValue || !newGroupName) {
      toast.error("请填写完整信息");
      return;
    }
    addMutation.mutate({
      label: newLabel,
      value: newValue,
      groupName: newGroupName,
      groupIcon: newGroupIcon || undefined,
    });
  };

  const GROUP_ICON_OPTIONS = [
    { label: "🖐️ 手部", value: "🖐️" },
    { label: "🧤 手套", value: "🧤" },
    { label: "🤖 机器人", value: "🤖" },
    { label: "🦶 足底", value: "🦶" },
    { label: "⚡ 高速", value: "⚡" },
    { label: "🚗 汽车", value: "🚗" },
    { label: "🛏️ 床垫", value: "🛏️" },
    { label: "📦 其他", value: "📦" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            传感器类型管理
          </h1>
          <p className="text-muted-foreground mt-1">
            管理系统中的传感器类型，支持增删和分组
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          添加传感器
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">
              {allSensors?.filter((s) => s.isActive).length ?? 0}
            </div>
            <p className="text-sm text-muted-foreground">启用中</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">
              {groupNames.length}
            </div>
            <p className="text-sm text-muted-foreground">分组数</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">
              {allSensors?.filter((s) => !s.isActive).length ?? 0}
            </div>
            <p className="text-sm text-muted-foreground">已禁用</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">
              {allSensors?.length ?? 0}
            </div>
            <p className="text-sm text-muted-foreground">总计</p>
          </CardContent>
        </Card>
      </div>

      {/* 筛选和列表 */}
      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={filterGroup} onValueChange={setFilterGroup}>
              <SelectTrigger className="w-[140px] bg-secondary/50">
                <SelectValue placeholder="筛选分组" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部分组</SelectItem>
                {groupNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showDisabled ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowDisabled(!showDisabled)}
            >
              {showDisabled ? "隐藏已禁用" : "显示已禁用"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : groupedSensors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Settings2 className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">暂无传感器类型</p>
            </div>
          ) : (
            <div className="space-y-6">
              {groupedSensors.map(([groupName, sensors]) => (
                <div key={groupName}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">
                      {sensors[0]?.groupIcon || "📦"}
                    </span>
                    <h3 className="font-medium text-foreground">{groupName}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {sensors.length}
                    </Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="text-muted-foreground w-16">ID</TableHead>
                          <TableHead className="text-muted-foreground">名称</TableHead>
                          <TableHead className="text-muted-foreground">标识符 (key)</TableHead>
                          <TableHead className="text-muted-foreground">排序</TableHead>
                          <TableHead className="text-muted-foreground">状态</TableHead>
                          <TableHead className="text-muted-foreground w-20">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sensors.map((sensor) => (
                          <TableRow
                            key={sensor.id}
                            className={`border-border/30 ${!sensor.isActive ? "opacity-50" : ""}`}
                          >
                            <TableCell className="text-sm text-muted-foreground">
                              {sensor.id}
                            </TableCell>
                            <TableCell className="text-sm font-medium text-foreground">
                              {sensor.label}
                            </TableCell>
                            <TableCell>
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                                {sensor.value}
                              </code>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {sensor.sortOrder}
                            </TableCell>
                            <TableCell>
                              {sensor.isActive ? (
                                <Badge className="bg-chart-2/10 text-chart-2 border-chart-2/30" variant="outline">
                                  启用
                                </Badge>
                              ) : (
                                <Badge className="bg-muted text-muted-foreground" variant="outline">
                                  已禁用
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {sensor.isActive ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                      onClick={() => {
                                        if (confirm(`确定要禁用「${sensor.label}」吗？`)) {
                                          deleteMutation.mutate({ id: sensor.id });
                                        }
                                      }}
                                      disabled={deleteMutation.isPending}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>禁用</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-chart-2 hover:text-chart-2"
                                      onClick={() => restoreMutation.mutate({ id: sensor.id })}
                                      disabled={restoreMutation.isPending}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>恢复</TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 添加传感器弹窗 */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>添加传感器类型</DialogTitle>
            <DialogDescription>
              添加新的传感器类型到系统中，可选择已有分组或创建新分组
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>传感器名称 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="例如：触觉手套"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>标识符 (key) <span className="text-destructive">*</span></Label>
              <Input
                placeholder="例如：hand0205（英文、数字、下划线）"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                标识符用于加密和存储，创建后不可更改，只能包含英文、数字和下划线
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>所属分组 <span className="text-destructive">*</span></Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setCustomGroup(!customGroup)}
                >
                  {customGroup ? "选择已有分组" : "新建分组"}
                </Button>
              </div>
              {customGroup ? (
                <Input
                  placeholder="输入新分组名称"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
              ) : (
                <Select value={newGroupName} onValueChange={setNewGroupName}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择分组" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {customGroup && (
              <div className="space-y-2">
                <Label>分组图标</Label>
                <Select value={newGroupIcon} onValueChange={setNewGroupIcon}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择图标（可选）" />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_ICON_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>
              取消
            </Button>
            <Button
              onClick={handleAdd}
              disabled={addMutation.isPending || !newLabel || !newValue || !newGroupName}
            >
              {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
