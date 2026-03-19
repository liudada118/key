import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Plus,
  Zap,
  X,
  RotateCcw,
  Grid3X3,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";

/** 传感器分组类型 */
type SensorGroup = {
  group: string;
  icon: string;
  items: { label: string; value: string }[];
};

/** 快捷预设 */
const PRESETS = [
  { label: "触觉全套", types: ["hand0205", "robot1", "robotSY", "robotLCF", "footVideo"] },
  { label: "汽车全套", types: ["car", "car10", "volvo", "carQX", "yanfeng10", "sofa"] },
  { label: "高速矩阵", types: ["fast256", "fast1024", "fast1024sit", "daliegu"] },
  { label: "床垫全套", types: ["bigBed", "jqbed", "smallBed", "xiyueReal1"] },
];

/** 时间预设 */
const TIME_PRESETS = [
  { label: "30天", days: 30 },
  { label: "90天", days: 90 },
  { label: "180天", days: 180 },
  { label: "1年", days: 365 },
  { label: "2年", days: 730 },
  { label: "3年", days: 1095 },
];

export default function GenerateKey() {
  const { data: sensorGroups, isLoading: sensorGroupsLoading } = trpc.keys.sensorGroups.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          生成密钥
        </h1>
        <p className="text-muted-foreground mt-1">
          选择传感器类型与有效期，生成量产密钥或在线租赁密钥
        </p>
      </div>

      {sensorGroupsLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs defaultValue="single" className="space-y-4">
          <TabsList className="bg-secondary">
            <TabsTrigger value="single">
              <KeyRound className="h-3.5 w-3.5 mr-1.5" />
              单个生成
            </TabsTrigger>
            <TabsTrigger value="batch">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              批量生成
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single">
            <KeyGenerator sensorGroups={sensorGroups || []} mode="single" />
          </TabsContent>
          <TabsContent value="batch">
            <KeyGenerator sensorGroups={sensorGroups || []} mode="batch" />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function KeyGenerator({
  sensorGroups,
  mode,
}: {
  sensorGroups: SensorGroup[];
  mode: "single" | "batch";
}) {
  // 传感器选择状态
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [isAll, setIsAll] = useState(false);

  // 参数状态
  const [category, setCategory] = useState<"production" | "rental">("production");
  const [days, setDays] = useState("365");
  const [count, setCount] = useState("10");
  const [remark, setRemark] = useState("");

  // 客户选择状态
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | undefined>(undefined);
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const utils = trpc.useUtils();
  const { data: customerList } = trpc.customers.all.useQuery();
  const createCustomerMutation = trpc.customers.create.useMutation({
    onSuccess: (data) => {
      if (data) {
        setSelectedCustomerId(data.id);
        setSelectedCustomerName(data.name);
      }
      setShowNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      // 刷新客户列表缓存，确保新创建的客户出现在下拉列表中
      utils.customers.all.invalidate();
      utils.customers.list.invalidate();
      toast.success("客户创建成功");
    },
    onError: (err) => toast.error(err.message),
  });

  // 结果状态
  const [singleResult, setSingleResult] = useState<{
    keyString: string;
    expireTimestamp: number;
  } | null>(null);
  const [batchResults, setBatchResults] = useState<{
    batchId: string;
    keys: { keyString: string }[];
    count: number;
  } | null>(null);

  // 所有传感器平铺
  const allSensors = useMemo(
    () => sensorGroups.flatMap((g) => g.items),
    [sensorGroups]
  );

  const sensorLabelMap = useMemo(
    () => Object.fromEntries(allSensors.map((s) => [s.value, s.label])),
    [allSensors]
  );

  const selectedCount = isAll ? allSensors.length : selectedTypes.length;

  // 全选/取消全选
  const handleToggleAll = useCallback(
    (checked: boolean) => {
      setIsAll(checked);
      if (checked) setSelectedTypes([]);
    },
    []
  );

  // 分组全选
  const handleGroupCheckAll = useCallback(
    (groupItems: { value: string }[], checked: boolean) => {
      const groupValues = groupItems.map((i) => i.value);
      setSelectedTypes((prev) => {
        if (checked) {
          const merged = new Set([...prev, ...groupValues]);
          return Array.from(merged);
        } else {
          return prev.filter((v) => !groupValues.includes(v));
        }
      });
      if (checked) setIsAll(false);
    },
    []
  );

  // 单个选择
  const handleTypeChange = useCallback(
    (value: string, checked: boolean) => {
      setSelectedTypes((prev) => {
        if (checked) return [...prev, value];
        return prev.filter((v) => v !== value);
      });
      setIsAll(false);
    },
    []
  );

  // 清空选择
  const handleClear = useCallback(() => {
    setSelectedTypes([]);
    setIsAll(false);
  }, []);

  // 获取要发送的 sensorTypes
  const getSensorTypesParam = useCallback((): string | string[] => {
    if (isAll) return "all";
    if (selectedTypes.length === 1) return selectedTypes[0];
    return selectedTypes;
  }, [isAll, selectedTypes]);

  // 单个生成
  const generateMutation = trpc.keys.generate.useMutation({
    onSuccess: (data) => {
      setSingleResult(data);
      toast.success("密钥生成成功");
    },
    onError: (err) => toast.error(err.message),
  });

  // 批量生成
  const batchMutation = trpc.keys.batchGenerate.useMutation({
    onSuccess: (data) => {
      setBatchResults(data);
      toast.success(`成功生成 ${data.count} 个密钥`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleGenerate = () => {
    if (!isAll && selectedTypes.length === 0) {
      return toast.error("请至少选择一个传感器类型，或开启全部授权");
    }
    if (!days || parseInt(days) < 1) return toast.error("请输入有效的天数");

    const sensorTypes = getSensorTypesParam();

    if (mode === "single") {
      generateMutation.mutate({
        sensorTypes,
        days: parseInt(days),
        category,
        customerId: selectedCustomerId,
        customerName: selectedCustomerName || undefined,
        remark: remark || undefined,
      });
    } else {
      if (!count || parseInt(count) < 1) return toast.error("请输入生成数量");
      batchMutation.mutate({
        sensorTypes,
        days: parseInt(days),
        category,
        count: parseInt(count),
        customerId: selectedCustomerId,
        customerName: selectedCustomerName || undefined,
        remark: remark || undefined,
      });
    }
  };

  const isPending = mode === "single" ? generateMutation.isPending : batchMutation.isPending;

  // 复制
  const copySingleKey = () => {
    if (singleResult) {
      navigator.clipboard.writeText(singleResult.keyString);
      toast.success("密钥已复制到剪贴板");
    }
  };

  const copyAll = () => {
    if (batchResults) {
      navigator.clipboard.writeText(
        batchResults.keys.map((k) => k.keyString).join("\n")
      );
      toast.success("所有密钥已复制到剪贴板");
    }
  };

  const downloadCSV = () => {
    if (!batchResults) return;
    const typeLabel = isAll
      ? "全部类型"
      : selectedTypes.map((v) => sensorLabelMap[v] || v).join("/");
    const catLabel = category === "production" ? "量产密钥" : "在线租赁密钥";
    const header = "序号,密钥,传感器类型,密钥类型,有效期天数";
    const rows = batchResults.keys.map(
      (k, i) => `${i + 1},${k.keyString},${typeLabel},${catLabel},${days}`
    );
    const csv = "\uFEFF" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keys_batch_${batchResults.batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV 文件已下载");
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* 左侧：传感器类型选择 (占 2 列) */}
      <div className="xl:col-span-2">
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                <Grid3X3 className="h-4 w-4 text-primary" />
                选择授权传感器类型
                <Badge variant="secondary" className="ml-1">
                  {selectedCount} / {allSensors.length}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={isAll}
                    onCheckedChange={handleToggleAll}
                    id={`all-switch-${mode}`}
                  />
                  <Label
                    htmlFor={`all-switch-${mode}`}
                    className="text-sm cursor-pointer text-foreground"
                  >
                    全部授权
                  </Label>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClear}
                  className="h-7 text-xs"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  清空
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* 快捷预设 */}
            <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-border/50">
              <span className="text-xs text-muted-foreground mr-1">快捷预设：</span>
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2"
                  onClick={() => {
                    setSelectedTypes(p.types);
                    setIsAll(false);
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            {/* 分组传感器选择 */}
            <ScrollArea className="h-[460px] pr-3">
              <div className="space-y-4">
                {sensorGroups.map((group) => {
                  const groupValues = group.items.map((i) => i.value);
                  const checkedCount = isAll
                    ? group.items.length
                    : groupValues.filter((v) => selectedTypes.includes(v)).length;
                  const allChecked = checkedCount === group.items.length;
                  const indeterminate = checkedCount > 0 && !allChecked;

                  return (
                    <div key={group.group} className="space-y-2">
                      {/* 分组标题 */}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isAll || allChecked}
                          disabled={isAll}
                          onCheckedChange={(checked) =>
                            handleGroupCheckAll(group.items, !!checked)
                          }
                          className={indeterminate && !isAll ? "data-[state=unchecked]:bg-primary/30" : ""}
                        />
                        <span className="text-sm">{group.icon}</span>
                        <span className="text-sm font-medium text-foreground">
                          {group.group}
                        </span>
                        <Badge
                          variant={allChecked || isAll ? "default" : "secondary"}
                          className="text-[10px] h-4 px-1.5"
                        >
                          {checkedCount}/{group.items.length}
                        </Badge>
                      </div>

                      {/* 分组内项目 */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5 pl-7">
                        {group.items.map((item) => (
                          <label
                            key={item.value}
                            className="flex items-center gap-1.5 cursor-pointer group"
                          >
                            <Checkbox
                              checked={isAll || selectedTypes.includes(item.value)}
                              disabled={isAll}
                              onCheckedChange={(checked) =>
                                handleTypeChange(item.value, !!checked)
                              }
                            />
                            <span className="text-sm text-foreground/80 group-hover:text-foreground transition-colors truncate">
                              {item.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* 右侧：参数设置 + 结果 */}
      <div className="space-y-6">
        {/* 参数卡片 */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
              <KeyRound className="h-4 w-4 text-primary" />
              授权参数
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 密钥类型 */}
            <div className="space-y-1.5">
              <Label className="text-foreground text-sm">密钥类型</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as "production" | "rental")}
              >
                <SelectTrigger className="bg-secondary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">量产密钥</SelectItem>
                  <SelectItem value="rental">在线租赁密钥</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 有效天数 */}
            <div className="space-y-1.5">
              <Label className="text-foreground text-sm">有效天数</Label>
              <Input
                type="number"
                min={1}
                max={36500}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="bg-secondary/50"
              />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {TIME_PRESETS.map((p) => (
                  <Button
                    key={p.days}
                    size="sm"
                    variant={parseInt(days) === p.days ? "default" : "outline"}
                    className="h-6 text-xs px-2"
                    onClick={() => setDays(String(p.days))}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-muted-foreground">到期时间：</span>
                <span className="text-foreground font-medium">
                  {new Date(
                    Date.now() + (parseInt(days) || 0) * 86400000
                  ).toLocaleDateString("zh-CN")}
                </span>
              </div>
            </div>

            {/* 批量数量 */}
            {mode === "batch" && (
              <div className="space-y-1.5">
                <Label className="text-foreground text-sm">生成数量</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  className="bg-secondary/50"
                />
              </div>
            )}

            {/* 客户选择 */}
            <div className="space-y-1.5">
              <Label className="text-foreground text-sm flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                关联客户（可选）
              </Label>
              {!showNewCustomer ? (
                <div className="space-y-2">
                  <Select
                    value={selectedCustomerId ? String(selectedCustomerId) : "none"}
                    onValueChange={(v) => {
                      if (v === "none") {
                        setSelectedCustomerId(undefined);
                        setSelectedCustomerName("");
                      } else {
                        const id = parseInt(v);
                        setSelectedCustomerId(id);
                        const c = customerList?.find((c) => c.id === id);
                        setSelectedCustomerName(c?.name || "");
                      }
                    }}
                  >
                    <SelectTrigger className="bg-secondary/50">
                      <SelectValue placeholder="选择客户（可不选）" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不关联客户</SelectItem>
                      {customerList?.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}{c.contactPerson ? ` (${c.contactPerson})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs w-full"
                    onClick={() => setShowNewCustomer(true)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    新建客户
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 p-3 bg-secondary/30 rounded-lg border border-border/50">
                  <Input
                    placeholder="客户名称 *"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="bg-secondary/50 h-8 text-sm"
                  />
                  <Input
                    placeholder="联系电话（可选）"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="bg-secondary/50 h-8 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1"
                      disabled={!newCustomerName.trim() || createCustomerMutation.isPending}
                      onClick={() => {
                        createCustomerMutation.mutate({
                          name: newCustomerName.trim(),
                          phone: newCustomerPhone || undefined,
                        });
                      }}
                    >
                      {createCustomerMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      创建
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        setShowNewCustomer(false);
                        setNewCustomerName("");
                        setNewCustomerPhone("");
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 备注 */}
            <div className="space-y-1.5">
              <Label className="text-foreground text-sm">备注（可选）</Label>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                className="bg-secondary/50 resize-none"
                placeholder="输入备注信息"
                rows={2}
              />
            </div>

            {/* 授权摘要 */}
            <div className="p-3 bg-secondary/30 rounded-lg space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">授权模式：</span>
                <span className="text-foreground font-medium">
                  {isAll
                    ? "全部授权"
                    : selectedTypes.length === 0
                      ? "未选择"
                      : selectedTypes.length === 1
                        ? "单类型"
                        : `多类型 (${selectedTypes.length})`}
                </span>
              </div>
              {!isAll && selectedTypes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedTypes.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="text-[10px] h-5 pl-1.5 pr-0.5 gap-0.5"
                    >
                      {sensorLabelMap[t] || t}
                      <button
                        onClick={() => handleTypeChange(t, false)}
                        className="ml-0.5 hover:bg-destructive/20 rounded-full p-0.5"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">有效天数：</span>
                <span className="text-foreground font-medium">{days} 天</span>
              </div>
            </div>

            {/* 生成按钮 */}
            <Button
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full"
              size="lg"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : mode === "single" ? (
                <KeyRound className="h-4 w-4 mr-2" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              {mode === "single" ? "生成密钥" : "批量生成"}
            </Button>
          </CardContent>
        </Card>

        {/* 结果卡片 */}
        <Card className="border-border/50">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-medium text-foreground">
              {mode === "single" ? "生成结果" : "批量结果"}
            </CardTitle>
            {mode === "batch" && batchResults && (
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={copyAll} className="h-7 text-xs">
                  <Copy className="h-3 w-3 mr-1" />
                  复制全部
                </Button>
                <Button size="sm" variant="outline" onClick={downloadCSV} className="h-7 text-xs">
                  <Download className="h-3 w-3 mr-1" />
                  CSV
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {mode === "single" && singleResult ? (
              <div className="space-y-3">
                <div className="relative">
                  <div className="p-3 bg-secondary/50 rounded-lg font-mono text-xs break-all text-foreground border border-border/50">
                    {singleResult.keyString}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={copySingleKey}
                    className="absolute top-1.5 right-1.5 h-6 w-6 p-0"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-secondary/30 rounded">
                    <p className="text-muted-foreground">密钥类型</p>
                    <p className="font-medium text-foreground mt-0.5">
                      {category === "production" ? "量产密钥" : "在线租赁密钥"}
                    </p>
                  </div>
                  <div className="p-2 bg-secondary/30 rounded">
                    <p className="text-muted-foreground">到期时间</p>
                    <p className="font-medium text-foreground mt-0.5">
                      {new Date(singleResult.expireTimestamp).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                </div>
              </div>
            ) : mode === "batch" && batchResults ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>批次号: {batchResults.batchId}</span>
                  <span>共 {batchResults.count} 个</span>
                </div>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-1 pr-2">
                    {batchResults.keys.map((k, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 p-1.5 bg-secondary/30 rounded group"
                      >
                        <span className="text-[10px] text-muted-foreground w-6 shrink-0 text-right">
                          {i + 1}.
                        </span>
                        <span className="font-mono text-[11px] break-all flex-1 text-foreground">
                          {k.keyString}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 h-5 w-5 p-0"
                          onClick={() => {
                            navigator.clipboard.writeText(k.keyString);
                            toast.success("已复制");
                          }}
                        >
                          <Copy className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <KeyRound className="h-10 w-10 mb-2 opacity-20" />
                <p className="text-xs">生成的密钥将显示在这里</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
