import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Calendar,
  Clock,
  Cpu,
  KeyRound,
  Loader2,
  Search,
  ShieldCheck,
  ShieldX,
  User,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const SENSOR_MAP: Record<string, string> = {
  yanfeng10: "轮椅",
  foot: "脚型检测",
  sit: "臀部监测",
  hand: "手部检测",
  car: "汽车",
  jqbed: "小床监测",
  matCol: "小床褥采集",
  matColPos: "小床睡姿采集",
  carCol: "车载传感器",
  normal: "正常测试",
  newHand: "手套监测",
  smallBed: "席悦1.0",
  xiyueReal1: "席悦2.0",
  all: "全部类型",
};

type VerifyResult = {
  valid: boolean;
  expireTimestamp?: number;
  sensorType?: string;
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
};

export default function VerifyKey() {
  const [keyInput, setKeyInput] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">密钥验证</h1>
        <p className="text-muted-foreground mt-1">解密验证密钥，查看详细信息</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
              <Search className="h-4 w-4 text-primary" />
              输入密钥
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="粘贴密钥字符串到这里..."
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
              验证密钥
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
                <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 border border-border/50">
                  {result.valid ? (
                    <>
                      <div className="h-10 w-10 rounded-full bg-chart-2/10 flex items-center justify-center shrink-0">
                        <ShieldCheck className="h-5 w-5 text-chart-2" />
                      </div>
                      <div>
                        <p className="font-medium text-chart-2">密钥有效</p>
                        <p className="text-sm text-muted-foreground">
                          剩余 {result.remainingDays} 天
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                        <ShieldX className="h-5 w-5 text-destructive" />
                      </div>
                      <div>
                        <p className="font-medium text-destructive">密钥无效</p>
                        <p className="text-sm text-muted-foreground">
                          {result.error || "密钥已过期"}
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {result.sensorType && (
                  <div className="grid grid-cols-2 gap-3">
                    <InfoItem
                      icon={Cpu}
                      label="传感器类型"
                      value={SENSOR_MAP[result.sensorType] || result.sensorType}
                    />
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
                      badgeColor={result.isActivated ? "bg-chart-2/10 text-chart-2 border-chart-2/30" : "bg-muted text-muted-foreground"}
                    />
                    <InfoItem
                      icon={User}
                      label="创建者"
                      value={result.createdByName || "未知"}
                    />
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
                )}

                {result.dbRemark && (
                  <div className="p-3 bg-secondary/30 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">备注</p>
                    <p className="text-sm text-foreground">{result.dbRemark}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <KeyRound className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-sm">验证结果将显示在这里</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
