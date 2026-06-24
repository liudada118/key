import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/* ============ 密钥生命周期状态标签 ============ */
const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ISSUED: { label: "已签发", className: "bg-muted text-muted-foreground border-border" },
  ACTIVATED: { label: "已激活", className: "bg-chart-2/10 text-chart-2 border-chart-2/30" },
  RENEWED: { label: "已续期", className: "bg-chart-2/10 text-chart-2 border-chart-2/30" },
  SUSPENDED: { label: "已暂停", className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  EXPIRED: { label: "已过期", className: "bg-muted text-muted-foreground border-border" },
  REVOKED: { label: "已吊销", className: "bg-red-500/10 text-red-600 border-red-500/30" },
  TAMPERED: { label: "异常", className: "bg-red-600 text-white border-red-700 font-semibold" },
  UNKNOWN: { label: "库中无记录", className: "bg-muted text-muted-foreground border-border" },
};

/* ============ 在线密钥验证结果字段 ============ */
type OnlineVerifyResult = {
  valid: boolean;
  status?: string;
  statusReason?: string | null;
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
  maxDevices?: number;
  deviceCount?: number;
  devices?: { id: number; deviceCode: string; deviceName?: string | null; boundAt: Date; boundIp?: string | null }[];
  deviceBound?: boolean;
};

/* ============ 离线密钥验证结果字段 ============ */
type OfflineVerifyResult = {
  valid: boolean;
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

/* ============ 统一验证结果（带类型判别） ============ */
type VerifyResult =
  | ({ kind: "online" } & OnlineVerifyResult)
  | ({ kind: "offline" } & OfflineVerifyResult)
  | { kind: "invalid"; valid: false; error: string };

/**
 * 自动识别密钥类型。
 * 离线激活码为 base64( JSON({ payload, signature }) )，能解析出该信封结构即判定为离线；
 * 否则视为在线密钥（AES 加密的 hex 字符串），交由服务端校验。
 */
function detectKeyType(raw: string): "online" | "offline" {
  try {
    const obj = JSON.parse(atob(raw));
    if (obj && typeof obj === "object" && obj.payload && obj.signature) {
      return "offline";
    }
  } catch {
    /* 解析失败说明不是离线信封 */
  }
  return "online";
}

export default function VerifyKey() {
  const [keyInput, setKeyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

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
  const verifyMutation = trpc.keys.verify.useMutation();

  /* ---- 在线密钥校验（服务端） ---- */
  const verifyOnline = async (keyString: string) => {
    const data = await verifyMutation.mutateAsync({ keyString });
    // 连解密都失败（拿不到到期时间）→ 既不是有效在线密钥也不是离线码，判为无效密钥
    if (!data.valid && data.expireTimestamp == null) {
      setResult({ kind: "invalid", valid: false, error: data.error || "无法识别的密钥，请检查是否输入正确" });
      toast.error("无效密钥");
      return;
    }
    // 失败原因优先取生命周期状态原因（吊销/暂停/异常），再退回解码错误
    const error = data.valid ? undefined : (data as any).statusReason || data.error || "在线密钥无效或已过期";
    setResult({ kind: "online", ...(data as any), error });
    if (data.valid) {
      toast.success("在线密钥验证成功");
    } else {
      toast.error(error);
    }
  };

  /* ---- 离线激活码校验（客户端 RSA 验签） ---- */
  const verifyOffline = async (code: string) => {
    // 解码激活码：base64( JSON({ payload, signature }) )，payload 为 base64 的明文 JSON
    let envelope: { payload?: string; signature?: string };
    try {
      envelope = JSON.parse(atob(code));
    } catch {
      setResult({ kind: "offline", valid: false, error: "激活码格式无效" });
      toast.error("激活码格式无效");
      return;
    }
    if (!envelope?.payload || !envelope?.signature) {
      setResult({ kind: "offline", valid: false, error: "激活码缺少 payload 或 signature" });
      toast.error("激活码格式无效");
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(atob(envelope.payload));
    } catch {
      setResult({ kind: "offline", valid: false, error: "激活码数据解析失败" });
      toast.error("激活码数据解析失败");
      return;
    }

    // 验证签名（使用 Web Crypto API），对 payload 的 base64 串验签
    if (publicKeyData?.publicKey) {
      try {
        const signatureBytes = Uint8Array.from(atob(envelope.signature), (c) => c.charCodeAt(0));
        const dataBytes = new TextEncoder().encode(envelope.payload);

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
          setResult({ kind: "offline", valid: false, error: "激活码签名验证失败，密钥可能被篡改" });
          toast.error("签名验证失败");
          return;
        }
      } catch (e) {
        console.error("签名验证异常:", e);
        setResult({ kind: "offline", valid: false, error: "签名验证过程出错" });
        toast.error("签名验证过程出错");
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
      kind: "offline",
      valid: !isExpired,
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
  };

  const handleVerify = async () => {
    const raw = keyInput.trim();
    if (!raw) return toast.error("请输入密钥");

    const kind = detectKeyType(raw);
    setVerifying(true);
    try {
      if (kind === "offline") {
        await verifyOffline(raw);
      } else {
        await verifyOnline(raw);
      }
    } catch (e: any) {
      console.error("验证异常:", e);
      setResult(null);
      toast.error(e?.message || "验证失败，请检查密钥格式");
    } finally {
      setVerifying(false);
    }
  };

  const sensorDisplay = useMemo(() => {
    if (!result || result.kind === "invalid") return null;
    if (result.isAllTypes) {
      return { mode: "全部授权", types: [] as string[] };
    }
    if (result.kind === "online") {
      if (result.sensorTypes && result.sensorTypes.length > 0) {
        return {
          mode: result.sensorTypes.length === 1 ? "单类型" : `多类型 (${result.sensorTypes.length})`,
          types: result.sensorTypes,
        };
      }
      if (result.sensorType) {
        const types = result.sensorType.split(",").filter(Boolean);
        return { mode: types.length === 1 ? "单类型" : `多类型 (${types.length})`, types };
      }
      return null;
    }
    // offline
    const types = Array.isArray(result.sensorTypes)
      ? result.sensorTypes
      : typeof result.sensorTypes === "string"
        ? result.sensorTypes.split(",").filter(Boolean)
        : [];
    return { mode: types.length === 1 ? "单类型" : `多类型 (${types.length})`, types };
  }, [result]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">密钥验证</h1>
        <p className="text-muted-foreground mt-1">粘贴任意密钥，系统自动识别在线密钥或离线激活码并展示授权信息</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 输入区 */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
              <KeyRound className="h-4 w-4 text-primary" />
              输入密钥
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="粘贴在线密钥或离线激活码到这里，验证后会自动识别类型..."
              className="bg-secondary/50 font-mono text-sm min-h-[140px] resize-none"
            />

            <Button onClick={handleVerify} disabled={verifying || !keyInput.trim()} className="w-full" size="lg">
              {verifying ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-2" />
              )}
              验证密钥
            </Button>
          </CardContent>
        </Card>

        {/* 结果区 */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
              验证结果
              {result && <KeyKindBadge kind={result.kind} />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-5">
                <StatusBanner
                  valid={result.valid}
                  error={result.error}
                  remainingDays={result.kind === "invalid" ? undefined : result.remainingDays}
                />

                {result.kind === "online" && <OnlineResultGrid result={result} />}
                {result.kind === "offline" && <OfflineResultGrid result={result} />}

                {sensorDisplay && result.kind !== "invalid" && (
                  <SensorTypesDisplay
                    isAllTypes={result.isAllTypes}
                    mode={sensorDisplay.mode}
                    types={sensorDisplay.types}
                    labelMap={sensorLabelMap}
                  />
                )}

                {/* 在线密钥：已绑定设备列表 */}
                {result.kind === "online" && result.devices && result.devices.length > 0 && (
                  <div className="p-3 bg-secondary/30 rounded-lg space-y-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Monitor className="h-3 w-3 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">已绑定设备</p>
                      <Badge variant="secondary" className="text-[10px] h-4 ml-1">
                        {result.devices.length} 台
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {result.devices.map((d: any) => (
                        <div key={d.id} className="flex items-center gap-2 text-xs p-1.5 bg-background/50 rounded">
                          <Monitor className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="font-mono font-medium text-foreground">{d.deviceCode}</span>
                          {d.deviceName && <span className="text-muted-foreground">({d.deviceName})</span>}
                          <span className="text-muted-foreground ml-auto">
                            {new Date(d.boundAt).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.kind === "online" && result.dbRemark && (
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
    </div>
  );
}

/* ============ 在线密钥结果字段 ============ */
function OnlineResultGrid({ result }: { result: OnlineVerifyResult }) {
  const statusCfg = result.status ? STATUS_LABELS[result.status] || STATUS_LABELS.UNKNOWN : null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {statusCfg && (
        <InfoItem icon={Shield} label="当前状态" value={statusCfg.label} badge badgeColor={statusCfg.className} />
      )}
      <InfoItem icon={Zap} label="密钥类型" value={result.category === "production" ? "量产密钥" : "在线租赁密钥"} />
      <InfoItem
        icon={Calendar}
        label="到期时间"
        value={result.expireTimestamp ? new Date(result.expireTimestamp).toLocaleString("zh-CN") : "-"}
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
          result.isActivated ? "bg-chart-2/10 text-chart-2 border-chart-2/30" : "bg-muted text-muted-foreground"
        }
      />
      <InfoItem
        icon={Monitor}
        label="设备绑定"
        value={`${result.deviceCount ?? 0} / ${result.maxDevices === 0 ? "∞" : result.maxDevices ?? 1}`}
      />
      <InfoItem icon={User} label="创建者" value={result.createdByName || "未知"} />
      {result.customerName && <InfoItem icon={Building2} label="关联客户" value={result.customerName} />}
      {result.activatedAt && (
        <InfoItem icon={Clock} label="激活时间" value={new Date(result.activatedAt).toLocaleString("zh-CN")} />
      )}
      {result.createdAt && (
        <InfoItem icon={Calendar} label="创建时间" value={new Date(result.createdAt).toLocaleString("zh-CN")} />
      )}
    </div>
  );
}

/* ============ 离线激活码结果字段 ============ */
function OfflineResultGrid({ result }: { result: OfflineVerifyResult }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <InfoItem icon={Zap} label="密钥类型" value="离线激活码" />
      {result.expireDate && <InfoItem icon={Calendar} label="到期时间" value={result.expireDate} />}
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
      {result.days && <InfoItem icon={Calendar} label="授权天数" value={`${result.days} 天`} />}
      {result.issuedAt && <InfoItem icon={Calendar} label="签发时间" value={result.issuedAt} />}
      {result.version && <InfoItem icon={Shield} label="版本" value={`v${result.version}`} />}
      {result.createdByName && <InfoItem icon={User} label="创建者" value={result.createdByName} />}
      {result.customerName && <InfoItem icon={Building2} label="关联客户" value={result.customerName} />}
    </div>
  );
}

/* ============ 共享组件 ============ */

function KeyKindBadge({ kind }: { kind: "online" | "offline" | "invalid" }) {
  if (kind === "invalid") {
    return (
      <Badge variant="outline" className="gap-1 bg-destructive/10 text-destructive border-destructive/30">
        <ShieldX className="h-3 w-3" />
        无效密钥
      </Badge>
    );
  }
  if (kind === "online") {
    return (
      <Badge variant="outline" className="gap-1 bg-primary/10 text-primary border-primary/30">
        <Wifi className="h-3 w-3" />
        在线密钥
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 bg-chart-4/10 text-chart-4 border-chart-4/30">
      <WifiOff className="h-3 w-3" />
      离线激活码
    </Badge>
  );
}

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
