import { useAuth } from "@/_core/hooks/useAuth";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import KeyGenerationGateDialog, {
  type GenerationContract,
} from "@/components/KeyGenerationGateDialog";
import { trpc } from "@/lib/trpc";
import {
  Copy,
  Download,
  KeyRound,
  Loader2,
  Zap,
  X,
  RotateCcw,
  Grid3X3,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";

/** 传感器分组类型 */
type SensorGroup = {
  group: string;
  icon: string;
  items: { label: string; value: string }[];
};

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
  const { data: sensorGroups, isLoading: sensorGroupsLoading } =
    trpc.sensors.groups.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          生成密钥
        </h1>
        <p className="text-muted-foreground mt-1">
          选择传感器类型与有效期，生成在线密钥
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
  const { user } = useAuth();

  // 传感器选择状态
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [isAll, setIsAll] = useState(false);

  // 参数状态
  // 已取消量产/在线租赁区分，所有密钥统一以 production 入库
  const category = "production" as const;
  const [days, setDays] = useState("30");
  const [count, setCount] = useState("10");
  const [remark, setRemark] = useState("");
  const [gateOpen, setGateOpen] = useState(false);

  const utils = trpc.useUtils();
  const {
    data: contractData,
    error: contractQueryError,
    isLoading: contractsLoading,
  } = trpc.contracts.list.useQuery({
    page: 1,
    pageSize: 1000,
    status: "ACTIVE",
    source: "feishu",
  });
  const contractList = (contractData?.items ?? []) as GenerationContract[];
  const contractSourceError =
    contractData && "error" in contractData ? contractData.error : undefined;
  const contractsError = contractQueryError?.message || contractSourceError;

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
    [sensorGroups],
  );

  const sensorLabelMap = useMemo(
    () => Object.fromEntries(allSensors.map((s) => [s.value, s.label])),
    [allSensors],
  );

  const selectedCount = isAll ? allSensors.length : selectedTypes.length;
  const sensorSummary = isAll
    ? "全部传感器"
    : selectedTypes.map((value) => sensorLabelMap[value] || value).join("、");

  // 全选/取消全选
  const handleToggleAll = useCallback((checked: boolean) => {
    setIsAll(checked);
    if (checked) setSelectedTypes([]);
  }, []);

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
    [],
  );

  // 单个选择
  const handleTypeChange = useCallback((value: string, checked: boolean) => {
    setSelectedTypes((prev) => {
      if (checked) return [...prev, value];
      return prev.filter((v) => v !== value);
    });
    setIsAll(false);
  }, []);

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
      setGateOpen(false);
      utils.contracts.list.invalidate();
      utils.keys.list.invalidate();
      toast.success("密钥生成成功");
    },
    onError: (err) => toast.error(err.message),
  });

  // 批量生成
  const batchMutation = trpc.keys.batchGenerate.useMutation({
    onSuccess: (data) => {
      setBatchResults(data);
      setGateOpen(false);
      utils.contracts.list.invalidate();
      utils.keys.list.invalidate();
      toast.success(`成功生成 ${data.count} 个密钥`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleGenerate = () => {
    if (!isAll && selectedTypes.length === 0) {
      return toast.error("请至少选择一个传感器类型，或开启全部授权");
    }
    if (!days || parseInt(days) < 1) return toast.error("请输入有效的天数");
    if (mode === "batch" && (!count || parseInt(count) < 1)) {
      return toast.error("请输入生成数量");
    }
    setGateOpen(true);
  };

  const handleGenerateWithContract = (contract: GenerationContract) => {
    const commonInput = {
      sensorTypes: getSensorTypesParam(),
      days: parseInt(days),
      category,
      contractId: contract.id,
      contractNo: contract.contractNo,
      remark: remark.trim() || undefined,
    };
    if (mode === "single") {
      generateMutation.mutate(commonInput);
      return;
    }
    batchMutation.mutate({
      ...commonInput,
      count: parseInt(count),
    });
  };

  const handleGenerateWithoutContract = (note?: string) => {
    const combinedRemark =
      [remark.trim(), note?.trim()].filter(Boolean).join("；") || undefined;
    const commonInput = {
      sensorTypes: getSensorTypesParam(),
      days: parseInt(days),
      category,
      remark: combinedRemark,
    };

    if (mode === "single") {
      generateMutation.mutate(commonInput);
      return;
    }
    batchMutation.mutate({
      ...commonInput,
      count: parseInt(count),
    });
  };

  const isPending =
    mode === "single" ? generateMutation.isPending : batchMutation.isPending;

  // 复制
  const copySingleKey = () => {
    if (singleResult) {
      copyText(singleResult.keyString);
      toast.success("密钥已复制到剪贴板");
    }
  };

  const copyAll = () => {
    if (batchResults) {
      copyText(batchResults.keys.map((k) => k.keyString).join("\n"));
      toast.success("所有密钥已复制到剪贴板");
    }
  };

  const downloadCSV = () => {
    if (!batchResults) return;
    const typeLabel = isAll
      ? "全部类型"
      : selectedTypes.map((v) => sensorLabelMap[v] || v).join("/");
    const header = "序号,密钥,传感器类型,有效期天数";
    const rows = batchResults.keys.map(
      (k, i) => `${i + 1},${k.keyString},${typeLabel},${days}`,
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
    <>
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
              {/* 分组传感器选择 */}
              <ScrollArea className="h-[460px] pr-3">
                <div className="space-y-4">
                  {sensorGroups.map((group) => {
                    const groupValues = group.items.map((i) => i.value);
                    const checkedCount = isAll
                      ? group.items.length
                      : groupValues.filter((v) => selectedTypes.includes(v))
                          .length;
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
                            className={
                              indeterminate && !isAll
                                ? "data-[state=unchecked]:bg-primary/30"
                                : ""
                            }
                          />
                          <span className="text-sm">{group.icon}</span>
                          <span className="text-sm font-medium text-foreground">
                            {group.group}
                          </span>
                          <Badge
                            variant={
                              allChecked || isAll ? "default" : "secondary"
                            }
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
                                checked={
                                  isAll || selectedTypes.includes(item.value)
                                }
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
                      variant={
                        parseInt(days) === p.days ? "default" : "outline"
                      }
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
                      Date.now() + (parseInt(days) || 0) * 86400000,
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
                <ButtonSpinner pending={isPending} />
                <KeyRound
                  className={
                    !isPending && mode === "single" ? "h-4 w-4" : "hidden"
                  }
                />
                <Zap
                  className={
                    !isPending && mode === "batch" ? "h-4 w-4" : "hidden"
                  }
                />
                <span>{mode === "single" ? "生成密钥" : "批量生成"}</span>
              </Button>
            </CardContent>
          </Card>

          {/* 结果卡片 */}
          <Card className="border-border/50">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium text-foreground">
                {mode === "single" ? "生成结果" : "批量结果"}
              </CardTitle>
              {mode === "batch" && (
                <div
                  className={batchResults ? "flex gap-1.5" : "hidden"}
                  aria-hidden={!batchResults}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyAll}
                    className="h-7 text-xs"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    复制全部
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={downloadCSV}
                    className="h-7 text-xs"
                  >
                    <Download className="h-3 w-3 mr-1" />
                    CSV
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {mode === "single" ? (
                <>
                  <div
                    data-slot="generation-placeholder"
                    className={
                      singleResult
                        ? "hidden"
                        : "flex h-32 flex-col items-center justify-center text-muted-foreground"
                    }
                  >
                    <KeyRound className="mb-2 h-10 w-10 opacity-20" />
                    <p className="text-xs">生成的密钥将显示在这里</p>
                  </div>
                  <div
                    data-slot="single-generation-result"
                    className={singleResult ? "space-y-3" : "hidden"}
                  >
                    <div className="relative">
                      <div className="p-3 bg-secondary/50 rounded-lg font-mono text-xs break-all text-foreground border border-border/50">
                        {singleResult?.keyString || ""}
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
                        <p className="text-muted-foreground">有效天数</p>
                        <p className="font-medium text-foreground mt-0.5">
                          {days} 天
                        </p>
                      </div>
                      <div className="p-2 bg-secondary/30 rounded">
                        <p className="text-muted-foreground">到期时间</p>
                        <p className="font-medium text-foreground mt-0.5">
                          {singleResult
                            ? new Date(
                                singleResult.expireTimestamp,
                              ).toLocaleDateString("zh-CN")
                            : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div
                    data-slot="generation-placeholder"
                    className={
                      batchResults
                        ? "hidden"
                        : "flex h-32 flex-col items-center justify-center text-muted-foreground"
                    }
                  >
                    <KeyRound className="mb-2 h-10 w-10 opacity-20" />
                    <p className="text-xs">生成的密钥将显示在这里</p>
                  </div>
                  <div
                    data-slot="batch-generation-result"
                    className={batchResults ? "space-y-2" : "hidden"}
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>批次号: {batchResults?.batchId || ""}</span>
                      <span>共 {batchResults?.count || 0} 个</span>
                    </div>
                    <ScrollArea className="h-[300px]">
                      <div className="space-y-1 pr-2">
                        {(batchResults?.keys || []).map((k, i) => (
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
                                copyText(k.keyString);
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
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <KeyGenerationGateDialog
        open={gateOpen}
        onOpenChange={setGateOpen}
        contracts={contractList}
        contractsLoading={contractsLoading}
        contractsError={contractsError || undefined}
        mode={mode}
        sensorTypes={getSensorTypesParam()}
        sensorSummary={sensorSummary}
        days={parseInt(days) || 1}
        count={mode === "batch" ? parseInt(count) || 1 : 1}
        category={category}
        generationRemark={remark.trim() || undefined}
        canGenerateWithoutContract={user?.role === "super_admin"}
        directGenerationPending={isPending}
        onGenerateWithContract={handleGenerateWithContract}
        onGenerateWithoutContract={handleGenerateWithoutContract}
      />
    </>
  );
}
