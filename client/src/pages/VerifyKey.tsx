import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  Calendar,
  Clock,
  Cpu,
  KeyRound,
  Loader2,
  Monitor,
  Search,
  Shield,
  ShieldCheck,
  ShieldX,
  User,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

/* ============ 在线密钥验证结果类型 ============ */
type OnlineVerifyResult = {
  valid: boolean;
  expireTimestamp?: number;
  sensorType?: string;
  sensorTypes?: string[];
  isAllTypes?: boolean;
  category?: string;
  expireDate?: string;
  remainingDays?: number;
  version?: number;
  error?: string;
  isActivated: boolean;
  activatedAt: Date | null;
  createdByName: string | null;
  createdAt: Date | null;
  dbRemark: string | null;
  customerName: string | null;
};

/* ============ 离线密钥验证结果类型 ============ */
type OfflineVerifyResult = {
  valid: boolean;
  machineId?: string;
  sensorTypes?: string[] | string;
  isAllTypes?: boolean;
  days?: number;
  expireDate?: string;
  remainingDays?: number;
  issuedAt?: string;
  version?: number;
  error?: string;
  customerName?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
};

export default function VerifyKey() {
  const [activeTab, setActiveTab] = useState("online");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">密钥验证</h1>
        <p className="text-muted-foreground mt-1">验证在线密钥或离线激活码，查看详细授权信息</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="online" className="gap-2">
            <Wifi className="h-4 w-4" />
            在线密钥验证
          </TabsTrigger>
          <TabsTrigger value="offline" className="gap-2">
            <WifiOff className="h-4 w-4" />
            离线密钥验证
          </TabsTrigger>
        </TabsList>

        <TabsContent value="online" className="mt-6">
          <OnlineVerifyPanel />
        </TabsContent>

        <TabsContent value="offline" className="mt-6">
          <OfflineVerifyPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============ 在线密钥验证面板 ============ */
function OnlineVerifyPanel() {
  const [keyInput, setKeyInput] = useState("");
  const [result, setResult] = useState<OnlineVerifyResult | null>(null);

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

  const verifyMutation = trpc.keys.verify.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.valid) {
        toast.success("密钥验证成功");
      } else {
        toast.error(data.error || "密钥无效或已过期");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const handleVerify = () => {
    if (!keyInput.trim()) return toast.error("请输入密钥");
    verifyMutation.mutate({ keyString: keyInput.trim() });
  };

  const sensorDisplay = useMemo(() => {
    if (!result) return null;
    if (result.isAllTypes) {
      return { mode: "全部授权", types: [] as string[] };
    }
    if (result.sensorTypes && result.sensorTypes.length > 0) {
      return {
        mode: result.sensorTypes.length === 1 ? "单类型" : `多类型 (${result.sensorTypes.length})`,
        types: result.sensorTypes,
      };
    }
    if (result.sensorType) {
      const types = result.sensorType.split(",").filter(Boolean);
      return {
        mode: types.length === 1 ? "单类型" : `多类型 (${types.length})`,
        types,
      };
    }
    return null;
  }, [result]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Wifi className="h-4 w-4 text-primary" />
            输入在线密钥
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="粘贴在线密钥字符串到这里..."
            className="bg-secondary/50 font-mono text-sm min-h-[120px] resize-none"
          />
          <Button
            onClick={handleVerify}
            disabled={verifyMutation.isPending}
            className="w-full"
            size="lg"
          >
            {verifyMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ShieldCheck className="h-4 w-4 mr-2" />
            )}
            验证在线密钥
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">验证结果</CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-5">
              <StatusBanner valid={result.valid} error={result.error} remainingDays={result.remainingDays} />

              <div className="grid grid-cols-2 gap-3">
                <InfoItem
                  icon={Zap}
                  label="密钥类型"
                  value={result.category === "production" ? "量产密钥" : "在线租赁密钥"}
                />
                <InfoItem
                  icon={Calendar}
                  label="到期时间"
                  value={
                    result.expireTimestamp
                      ? new Date(result.expireTimestamp).toLocaleString("zh-CN")
                      : "-"
                  }
                />
                <InfoItem
                  icon={Clock}
                  label="剩余天数"
                  value={
                    result.remainingDays !== undefined
                      ? result.remainingDays > 0
                        ? `${result.remainingDays} 天`
                        : "已过期"
                      : "-"
                  }
                />
                <InfoItem
                  icon={ShieldCheck}
                  label="激活状态"
                  value={result.isActivated ? "已激活" : "未激活"}
                  badge
                  badgeColor={
                    result.isActivated
                      ? "bg-chart-2/10 text-chart-2 border-chart-2/30"
                      : "bg-muted text-muted-foreground"
                  }
                />
                <InfoItem icon={User} label="创建者" value={result.createdByName || "未知"} />
                {result.customerName && (
                  <InfoItem icon={Building2} label="关联客户" value={result.customerName} />
                )}
                {result.activatedAt && (
                  <InfoItem
                    icon={Clock}
                    label="激活时间"
                    value={new Date(result.activatedAt).toLocaleString("zh-CN")}
                  />
                )}
                {result.createdAt && (
                  <InfoItem
                    icon={Calendar}
                    label="创建时间"
                    value={new Date(result.createdAt).toLocaleString("zh-CN")}
                  />
                )}
              </div>

              {sensorDisplay && (
                <SensorTypesDisplay
                  isAllTypes={result.isAllTypes}
                  mode={sensorDisplay.mode}
                  types={sensorDisplay.types}
                  labelMap={sensorLabelMap}
                />
              )}

              {result.dbRemark && (
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">备注</p>
                  <p className="text-sm text-foreground">{result.dbRemark}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyResult />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============ 离线密钥验证面板 ============ */
function OfflineVerifyPanel() {
  const [machineId, setMachineId] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [result, setResult] = useState<OfflineVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

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

  const { data: publicKeyData } = trpc.offlineKeys.publicKey.useQuery();

  const handleVerify = async () => {
    const mid = machineId.trim().toUpperCase();
    const code = activationCode.trim();

    if (!mid) return toast.error("请输入机器码");
    if (mid.length !== 16) return toast.error("机器码必须为16位");
    if (!code) return toast.error("请输入激活码");

    setVerifying(true);
    try {
      // 解码激活码
      const decoded = atob(code);
      const parts = decoded.split(".");
      if (parts.length !== 2) {
        setResult({ valid: false, error: "激活码格式无效" });
        toast.error("激活码格式无效");
        setVerifying(false);
        return;
      }

      const payloadStr = atob(parts[0]);
      let payload: any;
      try {
        payload = JSON.parse(payloadStr);
      } catch {
        setResult({ valid: false, error: "激活码数据解析失败" });
        toast.error("激活码数据解析失败");
        setVerifying(false);
        return;
      }

      // 验证机器码匹配
      if (payload.machineId !== mid) {
        setResult({
          valid: false,
          error: "机器码不匹配",
          machineId: payload.machineId,
        });
        toast.error("机器码不匹配");
        setVerifying(false);
        return;
      }

      // 验证签名（使用 Web Crypto API）
      if (publicKeyData?.publicKey) {
        try {
          const signatureB64 = parts[1];
          const signatureBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
          const dataBytes = new TextEncoder().encode(parts[0]);

          // 导入公钥
          const pemBody = publicKeyData.publicKey
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replace(/\s/g, "");
          const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
          const cryptoKey = await crypto.subtle.importKey(
            "spki",
            keyBytes.buffer,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"]
          );

          const isValid = await crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            cryptoKey,
            signatureBytes.buffer,
            dataBytes.buffer
          );

          if (!isValid) {
            setResult({ valid: false, error: "激活码签名验证失败，密钥可能被篡改" });
            toast.error("签名验证失败");
            setVerifying(false);
            return;
          }
        } catch (e) {
          console.error("签名验证异常:", e);
          setResult({ valid: false, error: "签名验证过程出错" });
          toast.error("签名验证过程出错");
          setVerifying(false);
          return;
        }
      }

      // 检查过期
      const now = Date.now();
      const expireTs = payload.expireTimestamp || payload.expireDate;
      const isExpired = expireTs && now > expireTs;

      const remainingDays = expireTs
        ? Math.max(0, Math.ceil((expireTs - now) / (1000 * 60 * 60 * 24)))
        : undefined;

      const sensorTypes = payload.sensorTypes || payload.types || [];
      const isAllTypes = sensorTypes === "all" || (Array.isArray(sensorTypes) && sensorTypes.includes("all"));

      setResult({
        valid: !isExpired,
        machineId: payload.machineId,
        sensorTypes: isAllTypes ? "all" : sensorTypes,
        isAllTypes,
        days: payload.days,
        expireDate: expireTs ? new Date(expireTs).toLocaleString("zh-CN") : undefined,
        remainingDays,
        issuedAt: payload.issuedAt ? new Date(payload.issuedAt).toLocaleString("zh-CN") : undefined,
        version: payload.version,
        error: isExpired ? "激活码已过期" : undefined,
      });

      if (isExpired) {
        toast.error("激活码已过期");
      } else {
        toast.success("离线激活码验证成功");
      }
    } catch (e) {
      console.error("验证异常:", e);
      setResult({ valid: false, error: "激活码解析失败，请检查格式" });
      toast.error("激活码解析失败");
    } finally {
      setVerifying(false);
    }
  };

  const sensorDisplay = useMemo(() => {
    if (!result) return null;
    if (result.isAllTypes) {
      return { mode: "全部授权", types: [] as string[] };
    }
    const types = Array.isArray(result.sensorTypes)
      ? result.sensorTypes
      : typeof result.sensorTypes === "string"
        ? result.sensorTypes.split(",").filter(Boolean)
        : [];
    return {
      mode: types.length === 1 ? "单类型" : `多类型 (${types.length})`,
      types,
    };
  }, [result]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <WifiOff className="h-4 w-4 text-primary" />
            输入离线激活码
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium">机器码（16位）</Label>
            <div className="relative mt-1.5">
              <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={machineId}
                onChange={(e) => setMachineId(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 16))}
                placeholder="例如：04A1E82A71675B47"
                className="pl-10 font-mono tracking-wider"
                maxLength={16}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{machineId.length}/16 位</p>
          </div>

          <div>
            <Label className="text-sm font-medium">激活码</Label>
            <Textarea
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value)}
              placeholder="粘贴离线激活码到这里..."
              className="mt-1.5 bg-secondary/50 font-mono text-xs min-h-[100px] resize-none"
            />
          </div>

          <Button
            onClick={handleVerify}
            disabled={verifying || machineId.length !== 16 || !activationCode.trim()}
            className="w-full"
            size="lg"
          >
            {verifying ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Shield className="h-4 w-4 mr-2" />
            )}
            验证离线激活码
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">验证结果</CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-5">
              <StatusBanner valid={result.valid} error={result.error} remainingDays={result.remainingDays} />

              <div className="grid grid-cols-2 gap-3">
                {result.machineId && (
                  <InfoItem icon={Monitor} label="机器码" value={result.machineId} />
                )}
                <InfoItem
                  icon={Zap}
                  label="密钥类型"
                  value="离线激活码"
                />
                {result.expireDate && (
                  <InfoItem icon={Calendar} label="到期时间" value={result.expireDate} />
                )}
                <InfoItem
                  icon={Clock}
                  label="剩余天数"
                  value={
                    result.remainingDays !== undefined
                      ? result.remainingDays > 0
                        ? `${result.remainingDays} 天`
                        : "已过期"
                      : "-"
                  }
                />
                {result.days && (
                  <InfoItem icon={Calendar} label="授权天数" value={`${result.days} 天`} />
                )}
                {result.issuedAt && (
                  <InfoItem icon={Calendar} label="签发时间" value={result.issuedAt} />
                )}
                {result.version && (
                  <InfoItem icon={Shield} label="版本" value={`v${result.version}`} />
                )}
                {result.createdByName && (
                  <InfoItem icon={User} label="创建者" value={result.createdByName} />
                )}
                {result.customerName && (
                  <InfoItem icon={Building2} label="关联客户" value={result.customerName} />
                )}
              </div>

              {sensorDisplay && (
                <SensorTypesDisplay
                  isAllTypes={result.isAllTypes}
                  mode={sensorDisplay.mode}
                  types={sensorDisplay.types}
                  labelMap={sensorLabelMap}
                />
              )}
            </div>
          ) : (
            <EmptyResult />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============ 共享组件 ============ */

function StatusBanner({ valid, error, remainingDays }: { valid: boolean; error?: string; remainingDays?: number }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 border border-border/50">
      {valid ? (
        <>
          <div className="h-10 w-10 rounded-full bg-chart-2/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-chart-2" />
          </div>
          <div>
            <p className="font-medium text-chart-2">验证通过</p>
            <p className="text-sm text-muted-foreground">
              {remainingDays !== undefined ? `剩余 ${remainingDays} 天` : "密钥有效"}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
            <ShieldX className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="font-medium text-destructive">验证失败</p>
            <p className="text-sm text-muted-foreground">{error || "密钥无效或已过期"}</p>
          </div>
        </>
      )}
    </div>
  );
}

function SensorTypesDisplay({
  isAllTypes,
  mode,
  types,
  labelMap,
}: {
  isAllTypes?: boolean;
  mode: string;
  types: string[];
  labelMap: Record<string, string>;
}) {
  return (
    <div className="p-3 bg-secondary/30 rounded-lg space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Cpu className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">授权传感器类型</p>
        <Badge variant="secondary" className="text-[10px] h-4 ml-1">
          {mode}
        </Badge>
      </div>
      {isAllTypes ? (
        <Badge variant="default" className="text-xs">
          全部传感器类型
        </Badge>
      ) : (
        <div className="flex flex-wrap gap-1">
          {types.map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">
              {labelMap[t] || t}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
      <KeyRound className="h-12 w-12 mb-3 opacity-20" />
      <p className="text-sm">验证结果将显示在这里</p>
    </div>
  );
}

function InfoItem({
  icon: Icon,
  label,
  value,
  badge,
  badgeColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  badge?: boolean;
  badgeColor?: string;
}) {
  return (
    <div className="p-3 bg-secondary/30 rounded-lg">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      {badge ? (
        <Badge variant="outline" className={`text-xs ${badgeColor}`}>
          {value}
        </Badge>
      ) : (
        <p className="text-sm font-medium text-foreground">{value}</p>
      )}
    </div>
  );
}
