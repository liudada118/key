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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  Copy,
  Download,
  FileText,
  KeyRound,
  Loader2,
  Plus,
  Shield,
} from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatLicenseScope } from "@shared/licenseScopes";

type SensorGroup = {
  group: string;
  /** 注册表里的分类 key；有值才支持「整个分类」授权 */
  groupKey?: string;
  icon: string;
  items: { label: string; value: string }[];
};

/** 分类 key → 该分类在注册表里的成员（用于判断哪些勾选项被「整个分类」覆盖） */
type LicenseGroupOption = {
  key: string;
  token: string;
  label: string;
  scopeLabel: string;
  sensorTypes: string[];
};

/**
 * 生成接口返回结构。`sensorTypes` 原样带回密钥里的授权范围：
 * `"all"` / 单系统 string / 数组（元素可能是 `@group:<key>` 分类令牌），
 * 所以这里不能收窄成 `string[] | "all"`。
 */
type OfflineKeyResult = {
  activationCode: string;
  sensorTypes: string | string[];
  expireDate: number;
  days: number;
  /** 含分类令牌时为 3，否则 2 */
  licenseVersion?: number;
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
  result: OfflineKeyResult | null;
  sensorLabelMap: Record<string, string>;
}) {
  const copyToClipboard = (text: string) => {
    copyText(text);
    toast.success("已复制到剪贴板");
  };

  const downloadAsFile = (code: string) => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `license_${new Date().toISOString().slice(0, 10)}.txt`;
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
              <span className="text-muted-foreground">有效天数：</span>
              <span className="ml-1">{result.days} 天</span>
            </div>
            <div>
              <span className="text-muted-foreground">到期时间：</span>
              <span className="ml-1">{new Date(result.expireDate).toLocaleDateString("zh-CN")}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">授权范围：</span>
              {/* 分类令牌渲染成「精密全部」而不是 @group:precision */}
              <span className="ml-1">
                {formatLicenseScope(result.sensorTypes, sensorLabelMap) || "（空）"}
              </span>
              {result.licenseVersion === 3 && (
                <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1.5">
                  分类授权 v3
                </Badge>
              )}
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
              onClick={() => downloadAsFile(result.activationCode)}
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
  groupScopeLabels,
  types,
  labelMap,
}: {
  /** 「整个分类」授权的中文名，如「精密全部」 */
  groupScopeLabels: string[];
  types: string[];
  labelMap: Record<string, string>;
}) {
  if (groupScopeLabels.length === 0 && types.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {/* 分类令牌用 default 底色区分：它是"随分类更新"的动态授权 */}
      {groupScopeLabels.map((label) => (
        <Badge
          key={label}
          variant="default"
          className="text-xs"
          title="整个分类授权：以后往该分类新增的系统会自动生效"
        >
          {label}
        </Badge>
      ))}
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

  // 注册表分类清单（「整个分类」开关用；与桌面端 licenseSensorGroups.json 同源）
  const { data: licenseGroupData } = trpc.sensors.licenseGroups.useQuery();
  const licenseGroups: LicenseGroupOption[] = licenseGroupData?.groups || [];

  // 客户列表
  const { data: customerList } = trpc.customers.all.useQuery();
  // 合同列表
  const { data: contractData } = trpc.contracts.list.useQuery({ page: 1, pageSize: 100, status: "ACTIVE", source: "feishu" });
  const contractList = contractData?.items ?? [];

  // 表单状态
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  /** 勾了「整个分类」的分类 key —— 激活码里存 `@group:<key>` 令牌，随分类更新 */
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([]);
  const [isAll, setIsAll] = useState(false);
  const [days, setDays] = useState(30);
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customerName, setCustomerName] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  // 合同选择状态
  const [contractId, setContractId] = useState<number | undefined>();
  const [contractNo, setContractNo] = useState("");
  const [remark, setRemark] = useState("");

  // 新建客户/合同 mutation
  const createCustomerMutation = trpc.customers.create.useMutation({
    onSuccess: (data) => {
      if (data) { setCustomerId(data.id); setCustomerName(data.name); }
      setShowNewCustomer(false); setNewCustomerName(""); setNewCustomerPhone("");
      utils.customers.all.invalidate();
      utils.customers.list.invalidate();
      toast.success("客户创建成功");
    },
    onError: (err) => toast.error(err.message),
  });

  // 生成结果
  const [result, setResult] = useState<OfflineKeyResult | null>(null);
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

  const licenseGroupByKey = useMemo(
    () => new Map(licenseGroups.map((g) => [g.key, g])),
    [licenseGroups]
  );

  /** 被已勾选的「整个分类」覆盖的系统（展示成勾中且不可单独取消） */
  const coveredByGroupScope = useMemo(() => {
    const covered = new Set<string>();
    for (const key of selectedGroupKeys) {
      for (const value of licenseGroupByKey.get(key)?.sensorTypes || []) {
        covered.add(value);
      }
    }
    return covered;
  }, [selectedGroupKeys, licenseGroupByKey]);

  const groupScopeLabels = useMemo(
    () =>
      selectedGroupKeys.map(
        (key) => licenseGroupByKey.get(key)?.scopeLabel || `${key}全部`
      ),
    [selectedGroupKeys, licenseGroupByKey]
  );

  const selectedCount = isAll
    ? allSensors.length
    : selectedGroupKeys.length + selectedTypes.length;
  const hasSelection = isAll || selectedGroupKeys.length > 0 || selectedTypes.length > 0;

  const handleToggleAll = useCallback((checked: boolean) => {
    setIsAll(checked);
    if (checked) {
      setSelectedTypes([]);
      setSelectedGroupKeys([]);
    }
  }, []);

  // 分组全选：勾具体成员，激活码里存固定数组，不随分类更新
  const handleGroupCheckAll = useCallback(
    (groupItems: { value: string }[], checked: boolean) => {
      const values = groupItems.map((i) => i.value);
      setSelectedTypes((prev) =>
        checked
          ? Array.from(new Set([...prev, ...values]))
          : prev.filter((v) => !values.includes(v))
      );
      if (checked) setIsAll(false);
    },
    []
  );

  /**
   * 「整个分类」开关：激活码里存 `@group:<key>` 令牌而不是当时的成员列表，
   * 以后往这个分类里加系统，未过期的旧激活码在新版客户端自动获得新增系统。
   * 同时把该分类在注册表里的成员从单选列表里摘掉（已被令牌覆盖，避免重复）。
   */
  const handleGroupScopeToggle = useCallback(
    (groupKey: string, checked: boolean) => {
      setSelectedGroupKeys((prev) =>
        checked
          ? prev.includes(groupKey) ? prev : [...prev, groupKey]
          : prev.filter((k) => k !== groupKey)
      );
      if (checked) {
        setIsAll(false);
        const covered = new Set(licenseGroupByKey.get(groupKey)?.sensorTypes || []);
        setSelectedTypes((prev) => prev.filter((v) => !covered.has(v)));
      }
    },
    [licenseGroupByKey]
  );

  const handleTypeChange = useCallback((value: string, checked: boolean) => {
    setSelectedTypes((prev) =>
      checked
        ? prev.includes(value) ? prev : [...prev, value]
        : prev.filter((v) => v !== value)
    );
    if (checked) setIsAll(false);
  }, []);

  // 授权范围入参：分类令牌在前，单系统在后。
  // 离线接口的 schema 只收 "all" 或数组，所以单条目也保持数组（服务端 normalizeLicenseFile 会归一化）。
  const getSensorTypesParam = useCallback((): "all" | string[] => {
    if (isAll) return "all";
    return [
      ...selectedGroupKeys.map(
        (key) => licenseGroupByKey.get(key)?.token || `@group:${key}`
      ),
      ...selectedTypes,
    ];
  }, [isAll, selectedGroupKeys, selectedTypes, licenseGroupByKey]);

  const handleGenerate = () => {
    if (!hasSelection) {
      toast.error("请至少选择一个传感器类型或一个分类");
      return;
    }
    generateMutation.mutate({
      sensorTypes: getSensorTypesParam(),
      days,
      customerId,
      customerName: customerName || undefined,
      contractId,
      contractNo: contractNo || undefined,
      remark: remark || undefined,
    });
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
          基于 RSA 签名生成离线激活码，无需联网即可验证（不绑定机器码）
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 左侧：传感器选择 */}
        <div className="xl:col-span-2 space-y-4">
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
                    onClick={() => { setSelectedTypes([]); setSelectedGroupKeys([]); setIsAll(false); }}
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
                    const groupOption = group.groupKey
                      ? licenseGroupByKey.get(group.groupKey)
                      : undefined;
                    const groupScopeOn = !!group.groupKey &&
                      selectedGroupKeys.includes(group.groupKey);
                    const isItemChecked = (value: string) =>
                      isAll || groupScopeOn && coveredByGroupScope.has(value) ||
                      selectedTypes.includes(value);
                    const checkedCount = isAll
                      ? group.items.length
                      : groupValues.filter(isItemChecked).length;
                    const allChecked = checkedCount === group.items.length;
                    const indeterminate = checkedCount > 0 && !allChecked;
                    /** 「整个分类」只覆盖注册表里的成员；normal 这类本地附加项要单独勾 */
                    const extraCount = group.items.filter(
                      (item) => !groupOption?.sensorTypes.includes(item.value)
                    ).length;

                    return (
                      <div key={group.group} className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
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

                          {/* 整个分类授权：激活码存 @group:<key> 令牌，随分类更新 */}
                          {groupOption && (
                            <label
                              className="flex items-center gap-1.5 ml-auto cursor-pointer"
                              title={
                                `勾上后激活码保存「${groupOption.scopeLabel}」这个分类令牌，` +
                                `以后往该分类里新增的系统，未过期的旧激活码会自动获得。` +
                                (extraCount > 0
                                  ? `注意：本组有 ${extraCount} 个不属于注册表的附加项，整组授权不覆盖，需要单独勾选。`
                                  : "")
                              }
                            >
                              <Switch
                                checked={groupScopeOn}
                                disabled={isAll}
                                onCheckedChange={(checked) =>
                                  handleGroupScopeToggle(groupOption.key, !!checked)
                                }
                              />
                              <span className="text-[11px] text-muted-foreground">
                                整个分类（随分类更新）
                              </span>
                            </label>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5 pl-7">
                          {group.items.map((item) => {
                            const lockedByGroupScope =
                              groupScopeOn && coveredByGroupScope.has(item.value);
                            return (
                              <label key={item.value} className="flex items-center gap-1.5 cursor-pointer group">
                                <Checkbox
                                  checked={isItemChecked(item.value)}
                                  disabled={isAll || lockedByGroupScope}
                                  onCheckedChange={(checked) => handleTypeChange(item.value, !!checked)}
                                />
                                <span className="text-sm text-foreground/80 group-hover:text-foreground transition-colors truncate">
                                  {item.label}
                                </span>
                              </label>
                            );
                          })}
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
                <Label className="text-sm font-medium flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> 关联客户（可选）
                </Label>
                {!showNewCustomer ? (
                  <div className="space-y-2 mt-1.5">
                    <Select
                      value={customerId?.toString() || "none"}
                      onValueChange={(v) => {
                        if (v === "none") { setCustomerId(undefined); setCustomerName(""); }
                        else { const id = parseInt(v); setCustomerId(id); const c = (customerList ?? []).find((c) => c.id === id); setCustomerName(c?.name || ""); }
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="选择客户" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">不关联客户</SelectItem>
                        {(customerList ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => setShowNewCustomer(true)}>
                      <Plus className="h-3 w-3 mr-1" /> 新建客户
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 mt-1.5 p-3 bg-secondary/30 rounded-lg border border-border/50">
                    <Input placeholder="客户名称 *" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} className="h-8 text-sm" />
                    <Input placeholder="联系电话（可选）" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} className="h-8 text-sm" />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs flex-1" disabled={!newCustomerName.trim() || createCustomerMutation.isPending}
                        onClick={() => createCustomerMutation.mutate({ name: newCustomerName.trim(), phone: newCustomerPhone || undefined })}>
                        {createCustomerMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}创建
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowNewCustomer(false); setNewCustomerName(""); setNewCustomerPhone(""); }}>取消</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* 关联合同 */}
              <div>
                <Label className="text-sm font-medium flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> 关联合同（可选）
                </Label>
                <Select
                  value={contractId?.toString() || "none"}
                  onValueChange={(v) => {
                    if (v === "none") {
                      setContractId(undefined);
                      setContractNo("");
                    } else {
                      const id = parseInt(v);
                      setContractId(id);
                      const c = contractList.find((c: any) => c.id === id);
                      setContractNo(c?.contractNo || "");
                    }
                  }}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="选择飞书合同" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联合同</SelectItem>
                    {contractData && "error" in contractData && contractData.error ? (
                      <SelectItem value="feishu-config-error" disabled>
                        {contractData.error}
                      </SelectItem>
                    ) : contractList.length === 0 ? (
                      <SelectItem value="feishu-empty" disabled>
                        飞书表格暂无生效合同
                      </SelectItem>
                    ) : (
                      contractList.map((c: any) => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.contractNo}{c.customerName ? ` - ${c.customerName}` : ""}
                        </SelectItem>
                      ))
                    )}
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
                  <span className="text-muted-foreground">授权模式：</span>
                  <span>
                    {isAll
                      ? "全部授权"
                      : selectedGroupKeys.length > 0 && selectedTypes.length === 0
                        ? `分类授权 (${selectedGroupKeys.length})`
                        : `多类型 (${selectedCount})`}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">有效天数：</span>
                  <span>{days} 天</span>
                </div>
              </div>

              {/* 已选传感器标签 */}
              <SelectedSensorTags
                groupScopeLabels={isAll ? [] : groupScopeLabels}
                types={isAll ? [] : selectedTypes}
                labelMap={sensorLabelMap}
              />

              {/* 生成按钮 */}
              <Button
                className="w-full"
                size="lg"
                onClick={handleGenerate}
                disabled={generateMutation.isPending || !hasSelection}
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
