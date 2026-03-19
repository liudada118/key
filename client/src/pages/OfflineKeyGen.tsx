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
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  Copy,
  Download,
  KeyRound,
  Loader2,
  Monitor,
  Shield,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

type SensorGroup = {
  group: string;
  icon: string;
  items: { label: string; value: string }[];
};

const TIME_PRESETS = [
  { label: "30天", days: 30 },
  { label: "90天", days: 90 },
  { label: "180天", days: 180 },
  { label: "1年", days: 365 },
  { label: "2年", days: 730 },
  { label: "3年", days: 1095 },
];

/* ============ 生成结果弹窗（独立组件避免 DOM 协调问题） ============ */
function ResultDialog({
  open,
  onOpenChange,
  result,
  sensorLabelMap,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: {
    activationCode: string;
    machineId: string;
    sensorTypes: string[] | "all";
    expireDate: number;
    days: number;
  } | null;
  sensorLabelMap: Record<string, string>;
}) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  const downloadAsFile = (code: string, mid: string) => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `license_${mid}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("激活码文件已下载");
  };

  if (!result) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-600" />
            离线激活码生成成功
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">机器码：</span>
              <span className="font-mono ml-1">{result.machineId}</span>
            </div>
            <div>
              <span className="text-muted-foreground">有效天数：</span>
              <span className="ml-1">{result.days} 天</span>
            </div>
            <div>
              <span className="text-muted-foreground">到期时间：</span>
              <span className="ml-1">{new Date(result.expireDate).toLocaleDateString("zh-CN")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">授权类型：</span>
              <span className="ml-1">
                {result.sensorTypes === "all"
                  ? "全部授权"
                  : `${result.sensorTypes.length} 个传感器`}
              </span>
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium mb-1.5 block">激活码</Label>
            <div className="bg-muted rounded-lg p-3 relative">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                {result.activationCode}
              </pre>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => copyToClipboard(result.activationCode)}
            >
              <Copy className="h-4 w-4 mr-2" />
              复制激活码
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => downloadAsFile(result.activationCode, result.machineId)}
            >
              <Download className="h-4 w-4 mr-2" />
              下载文件
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============ 传感器类型标签列表（独立组件） ============ */
function SelectedSensorTags({
  types,
  labelMap,
}: {
  types: string[];
  labelMap: Record<string, string>;
}) {
  if (types.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => (
        <Badge key={t} variant="secondary" className="text-xs">
          {labelMap[t] || t}
        </Badge>
      ))}
    </div>
  );
}

/* ============ 主页面 ============ */
export default function OfflineKeyGen() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // 传感器数据
  const { data: sensorGroupsRaw, isLoading: sensorsLoading } = trpc.sensors.groups.useQuery();
  const sensorGroups: SensorGroup[] = useMemo(() => sensorGroupsRaw ?? [], [sensorGroupsRaw]);

  // 客户列表
  const { data: customerList } = trpc.customers.all.useQuery();

  // 离线密钥列表
  const [listPage, setListPage] = useState(1);
  const [listSearch, setListSearch] = useState("");
  const { data: offlineKeyList, isLoading: listLoading } = trpc.offlineKeys.list.useQuery({
    page: listPage,
    pageSize: 10,
    search: listSearch || undefined,
  });

  // 表单状态
  const [machineId, setMachineId] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [isAll, setIsAll] = useState(false);
  const [days, setDays] = useState(365);
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [remark, setRemark] = useState("");

  // 生成结果
  const [result, setResult] = useState<{
    activationCode: string;
    machineId: string;
    sensorTypes: string[] | "all";
    expireDate: number;
    days: number;
  } | null>(null);
  const [showResult, setShowResult] = useState(false);

  // 生成 mutation
  const generateMutation = trpc.offlineKeys.generate.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setShowResult(true);
      utils.offlineKeys.list.invalidate();
      toast.success("离线激活码生成成功");
    },
    onError: (err) => {
      toast.error(err.message || "生成失败");
    },
  });

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

  const handleToggleAll = useCallback((checked: boolean) => {
    setIsAll(checked);
    if (checked) setSelectedTypes([]);
  }, []);

  const handleGroupCheckAll = useCallback(
    (groupItems: { value: string }[], checked: boolean) => {
      const values = groupItems.map((i) => i.value);
      setSelectedTypes((prev) =>
        checked
          ? Array.from(new Set([...prev, ...values]))
          : prev.filter((v) => !values.includes(v))
      );
    },
    []
  );

  const handleTypeChange = useCallback((value: string, checked: boolean) => {
    setSelectedTypes((prev) =>
      checked ? [...prev, value] : prev.filter((v) => v !== value)
    );
  }, []);

  const handleGenerate = () => {
    if (!machineId || machineId.length !== 16) {
      toast.error("请输入16位机器码");
      return;
    }
    if (!isAll && selectedTypes.length === 0) {
      toast.error("请至少选择一个传感器类型");
      return;
    }
    generateMutation.mutate({
      machineId: machineId.toUpperCase(),
      sensorTypes: isAll ? "all" : selectedTypes,
      days,
      customerId,
      remark: remark || undefined,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("已复制到剪贴板");
  };

  const downloadAsFile = (code: string, mid: string) => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `license_${mid}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("激活码文件已下载");
  };

  if (sensorsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          离线密钥
        </h1>
        <p className="text-muted-foreground mt-1">
          基于 RSA 签名生成绑定机器码的离线激活码，无需联网即可验证
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 左侧：传感器选择 + 机器码 */}
        <div className="xl:col-span-2 space-y-4">
          {/* 机器码输入 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Monitor className="h-4 w-4 text-primary" />
                机器码
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Label className="text-sm text-muted-foreground mb-1.5 block">
                    输入客户的 16 位机器码（MAC 地址）
                  </Label>
                  <Input
                    placeholder="例如: 04A1E82A71675B47"
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 16))}
                    className="font-mono text-base tracking-wider"
                    maxLength={16}
                  />
                </div>
                <Badge variant={machineId.length === 16 ? "default" : "secondary"} className="h-8 px-3">
                  {machineId.length}/16
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* 传感器选择 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  选择授权传感器类型
                  <Badge variant="outline" className="ml-1">{selectedCount}/{allSensors.length}</Badge>
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="offline-all-auth"
                      checked={isAll}
                      onCheckedChange={handleToggleAll}
                    />
                    <Label htmlFor="offline-all-auth" className="text-sm cursor-pointer">全部授权</Label>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSelectedTypes([]); setIsAll(false); }}
                    className="h-7 text-xs"
                  >
                    清空
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ScrollArea className="h-[340px] pr-3">
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
                          <span className="text-sm font-medium text-foreground">{group.group}</span>
                          <Badge
                            variant={allChecked || isAll ? "default" : "secondary"}
                            className="text-[10px] h-4 px-1.5"
                          >
                            {checkedCount}/{group.items.length}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5 pl-7">
                          {group.items.map((item) => (
                            <label key={item.value} className="flex items-center gap-1.5 cursor-pointer group">
                              <Checkbox
                                checked={isAll || selectedTypes.includes(item.value)}
                                disabled={isAll}
                                onCheckedChange={(checked) => handleTypeChange(item.value, !!checked)}
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

        {/* 右侧：授权参数 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                授权参数
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 有效天数 */}
              <div>
                <Label className="text-sm font-medium">有效天数</Label>
                <Input
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={36500}
                  className="mt-1.5"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {TIME_PRESETS.map((p) => (
                    <Button
                      key={p.days}
                      size="sm"
                      variant={days === p.days ? "default" : "outline"}
                      className="h-7 text-xs px-2.5"
                      onClick={() => setDays(p.days)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  到期时间：{new Date(Date.now() + days * 86400000).toLocaleDateString("zh-CN")}
                </p>
              </div>

              {/* 关联客户 */}
              <div>
                <Label className="text-sm font-medium">关联客户（可选）</Label>
                <Select
                  value={customerId?.toString() || "none"}
                  onValueChange={(v) => setCustomerId(v === "none" ? undefined : parseInt(v))}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="选择客户" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联客户</SelectItem>
                    {(customerList ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 备注 */}
              <div>
                <Label className="text-sm font-medium">备注（可选）</Label>
                <Textarea
                  placeholder="输入备注信息"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  className="mt-1.5 h-20 resize-none"
                />
              </div>

              {/* 摘要 */}
              <div className="border-t pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">机器码：</span>
                  <span className="font-mono text-xs">{machineId || "未输入"}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">授权模式：</span>
                  <span>{isAll ? "全部授权" : `多类型 (${selectedCount})`}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">有效天数：</span>
                  <span>{days} 天</span>
                </div>
              </div>

              {/* 已选传感器标签 */}
              <SelectedSensorTags
                types={isAll ? [] : selectedTypes}
                labelMap={sensorLabelMap}
              />

              {/* 生成按钮 */}
              <Button
                className="w-full"
                size="lg"
                onClick={handleGenerate}
                disabled={generateMutation.isPending || machineId.length !== 16 || (!isAll && selectedTypes.length === 0)}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Shield className="h-4 w-4 mr-2" />
                )}
                生成离线激活码
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 历史记录 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">生成记录</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="搜索机器码/客户..."
                  value={listSearch}
                  onChange={(e) => { setListSearch(e.target.value); setListPage(1); }}
                  className="pl-8 h-8 w-48 text-sm"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <OfflineKeyTable
            loading={listLoading}
            data={offlineKeyList}
            sensorLabelMap={sensorLabelMap}
            page={listPage}
            onPageChange={setListPage}
            onCopy={copyToClipboard}
            onDownload={downloadAsFile}
          />
        </CardContent>
      </Card>

      {/* 生成结果弹窗 - 独立组件 */}
      <ResultDialog
        open={showResult}
        onOpenChange={setShowResult}
        result={result}
        sensorLabelMap={sensorLabelMap}
      />
    </div>
  );
}

/* ============ 离线密钥表格（独立组件） ============ */
function OfflineKeyTable({
  loading,
  data,
  sensorLabelMap,
  page,
  onPageChange,
  onCopy,
  onDownload,
}: {
  loading: boolean;
  data: { items: any[]; total: number; pageSize: number } | undefined;
  sensorLabelMap: Record<string, string>;
  page: number;
  onPageChange: (p: number) => void;
  onCopy: (text: string) => void;
  onDownload: (code: string, machineId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data || !data.items.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        暂无离线密钥记录
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / data.pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">机器码</TableHead>
              <TableHead>传感器类型</TableHead>
              <TableHead className="w-24">有效天数</TableHead>
              <TableHead className="w-32">到期时间</TableHead>
              <TableHead className="w-24">客户</TableHead>
              <TableHead className="w-32">创建时间</TableHead>
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((item) => {
              const sensorTypesArr = item.sensorTypes === "all" ? [] : item.sensorTypes.split(",");
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.machineId}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.sensorTypes === "all" ? (
                        <Badge variant="default" className="text-[10px]">全部授权</Badge>
                      ) : (
                        <>
                          {sensorTypesArr.slice(0, 3).map((t: string) => (
                            <Badge key={t} variant="secondary" className="text-[10px]">
                              {sensorLabelMap[t] || t}
                            </Badge>
                          ))}
                          {sensorTypesArr.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{sensorTypesArr.length - 3}
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{item.days}天</TableCell>
                  <TableCell className="text-xs">
                    {new Date(item.expireDate).toLocaleDateString("zh-CN")}
                  </TableCell>
                  <TableCell className="text-sm">{item.customerName || "-"}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => onCopy(item.activationCode)}
                        title="复制激活码"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => onDownload(item.activationCode, item.machineId)}
                        title="下载激活码"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {data.total > data.pageSize && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            共 {data.total} 条记录
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              {page}/{totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
