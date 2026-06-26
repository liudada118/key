import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Cable,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  RotateCcw,
  Wifi,
  WifiOff,
  Armchair,
} from "lucide-react";
import { toast } from "sonner";
import {
  serialMacService,
  type ConnectionStatus,
  type MacResult,
  type LogEntry,
} from "@/lib/SerialMacService";
import { trpc } from "@/lib/trpc";
import { ContractPicker, type ContractValue } from "@/components/ContractPicker";

// ===== 坐垫插槽定义 =====
type SeatSlot = "back" | "seat";

interface SlotState {
  label: string;
  mac: string | null;
  status: "empty" | "reading" | "done";
  timestamp?: number;
}

const SEAT_SLOTS: SeatSlot[] = ["back", "seat"];

const SLOT_LABELS: Record<SeatSlot, string> = {
  back: "靠背",
  seat: "座椅",
};

const SLOT_ICONS: Record<SeatSlot, string> = {
  back: "🪑",
  seat: "💺",
};

const SLOT_COLORS: Record<SeatSlot, { bg: string; border: string; text: string; ring: string }> = {
  back: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-700",
    ring: "ring-orange-400",
  },
  seat: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    ring: "ring-amber-400",
  },
};

// 前缀选项
type PrefixOption = "endi" | "carY";

const PREFIX_OPTIONS: { value: PrefixOption; label: string }[] = [
  { value: "endi", label: "endi" },
  { value: "carY", label: "carY" },
];

// 坐垫固定波特率
const SEAT_BAUD_RATE = 1000000;

// ===== 连接状态指示器 =====
function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; pulse: boolean; label: string }> = {
    disconnected: { color: "bg-gray-400", pulse: false, label: "未连接" },
    connecting: { color: "bg-yellow-400", pulse: true, label: "连接中..." },
    detecting: { color: "bg-blue-400", pulse: true, label: "探测中..." },
    connected: { color: "bg-emerald-400", pulse: true, label: "已连接" },
    reading: { color: "bg-yellow-400", pulse: true, label: "读取中..." },
    error: { color: "bg-red-400", pulse: false, label: "错误" },
  };
  const c = config[status];
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {c.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${c.color} opacity-75 animate-ping`} />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c.color}`} />
      </span>
      <span className="text-sm font-medium text-foreground">{c.label}</span>
    </div>
  );
}

// ===== 插槽卡片 =====
function SeatSlotCard({
  slot,
  state,
  isActive,
  onRead,
  disabled,
}: {
  slot: SeatSlot;
  state: SlotState;
  isActive: boolean;
  onRead: () => void;
  disabled: boolean;
}) {
  const colors = SLOT_COLORS[slot];
  const isReading = state.status === "reading";
  const isDone = state.status === "done";

  return (
    <Card
      className={`relative transition-all duration-300 ${
        isActive
          ? `${colors.border} ring-2 ${colors.ring} shadow-md`
          : isDone
            ? `${colors.border} opacity-90`
            : "border-border/50"
      }`}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center text-xl ${
                isDone ? colors.bg : "bg-muted/50"
              }`}
            >
              {SLOT_ICONS[slot]}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{SLOT_LABELS[slot]}</h3>
              <p className="text-xs text-muted-foreground">{slot}</p>
            </div>
          </div>
          {isDone ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 border">
              <Check className="h-3 w-3 mr-1" />
              已读取
            </Badge>
          ) : isReading ? (
            <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 border">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              读取中
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              等待读取
            </Badge>
          )}
        </div>

        {/* MAC 地址显示 */}
        <div
          className={`rounded-lg p-3 mb-4 font-mono text-sm ${
            isDone
              ? `${colors.bg} ${colors.text} font-semibold`
              : "bg-muted/30 text-muted-foreground"
          }`}
        >
          {state.mac || "—— 未读取 ——"}
        </div>

        {/* 读取按钮 */}
        <Button
          onClick={onRead}
          disabled={disabled || isReading}
          className="w-full"
          variant={isDone ? "outline" : "default"}
          size="sm"
        >
          {isReading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              正在读取...
            </>
          ) : isDone ? (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              重新读取
            </>
          ) : (
            <>
              <Cable className="h-4 w-4 mr-2" />
              连接并读取 MAC
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ===== 主页面 =====
export default function SeatDeviceCode() {
  const [slots, setSlots] = useState<Record<SeatSlot, SlotState>>({
    back: { label: "靠背", mac: null, status: "empty" },
    seat: { label: "座椅", mac: null, status: "empty" },
  });
  const [activeSlot, setActiveSlot] = useState<SeatSlot | null>(null);
  const [serialStatus, setSerialStatus] = useState<ConnectionStatus>("disconnected");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [prefix, setPrefix] = useState<PrefixOption>("endi");
  const logEndRef = useRef<HTMLDivElement>(null);
  const macCallbackRef = useRef<((result: MacResult) => void) | null>(null);

  // 关联合同（可选）+ 读取记录
  const [contract, setContract] = useState<ContractValue>({});
  const contractRef = useRef<ContractValue>({});
  contractRef.current = contract;
  const recordMutation = trpc.deviceCodes.record.useMutation();
  const recordRef = useRef(recordMutation);
  recordRef.current = recordMutation;
  const recordRead = (slot: SeatSlot, mac: string | null, success: boolean) => {
    recordRef.current.mutate({
      deviceType: "seat",
      slot,
      slotLabel: SLOT_LABELS[slot],
      mac: mac || undefined,
      success,
      contractId: contractRef.current.contractId,
      contractNo: contractRef.current.contractNo || undefined,
    });
  };

  // 滚动日志到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // 初始化 SerialMacService 回调
  useEffect(() => {
    serialMacService.setOnLog((entry) => {
      setLogs((prev) => [...prev.slice(-100), entry]);
    });
    serialMacService.setOnStatus((status) => {
      setSerialStatus(status);
    });
    serialMacService.setOnMac((result) => {
      macCallbackRef.current?.(result);
    });
  }, []);

  // 读取某个 slot 的 MAC 地址
  const handleReadSlot = useCallback(
    async (slot: SeatSlot) => {
      // 如果当前有连接，先断开
      if (serialMacService.connected) {
        await serialMacService.disconnect();
      }

      setActiveSlot(slot);
      setSlots((prev) => ({
        ...prev,
        [slot]: { ...prev[slot], status: "reading", mac: null },
      }));

      // 设置 MAC 回调 — 读取到 MAC 后自动填入 slot
      macCallbackRef.current = async (result: MacResult) => {
        setSlots((prev) => ({
          ...prev,
          [slot]: {
            ...prev[slot],
            mac: result.uniqueId,
            status: "done",
            timestamp: result.timestamp,
          },
        }));
        setActiveSlot(null);
        macCallbackRef.current = null;
        toast.success(`${SLOT_LABELS[slot]} MAC 读取成功: ${result.uniqueId}`);
        recordRead(slot, result.uniqueId, true);

        // 读取完成后自动断开
        try {
          await serialMacService.disconnect();
        } catch (_) {}
      };

      // 坐垫使用固定波特率 1000000 连接
      const success = await serialMacService.connect(SEAT_BAUD_RATE);
      if (success) {
        // 连接成功后，主动发送 AT 指令读取 MAC 地址
        await serialMacService.sendAtCommand();
      } else {
        setSlots((prev) => ({
          ...prev,
          [slot]: { ...prev[slot], status: "empty" },
        }));
        setActiveSlot(null);
        macCallbackRef.current = null;
        toast.error("连接失败，请检查设备连接");
        recordRead(slot, null, false);
      }
    },
    []
  );

  // 生成输出字符串
  const outputString = useMemo(() => {
    const SUFFIX_MAP: Record<SeatSlot, string> = { back: "back", seat: "sit" };
    const parts = SEAT_SLOTS.map((slot) => {
      const mac = slots[slot].mac;
      if (!mac) return null;
      return `${mac}:${prefix}-${SUFFIX_MAP[slot]}`;
    }).filter(Boolean);
    return parts.join(",");
  }, [slots, prefix]);

  // 已完成的数量
  const doneCount = SEAT_SLOTS.filter((s) => slots[s].status === "done").length;
  const allDone = doneCount === 2;

  // 复制输出
  const handleCopy = useCallback(async () => {
    if (!outputString) {
      toast.error("请先读取至少一个座椅设备的 MAC 地址");
      return;
    }
    try {
      await navigator.clipboard.writeText(outputString);
      setCopied(true);
      toast.success("设备码已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = outputString;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      toast.success("设备码已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    }
  }, [outputString]);

  // 全部重置
  const handleReset = useCallback(() => {
    setSlots({
      back: { label: "靠背", mac: null, status: "empty" },
      seat: { label: "座椅", mac: null, status: "empty" },
    });
    setActiveSlot(null);
    setLogs([]);
    toast.info("已重置所有插槽");
  }, []);

  // 浏览器不支持
  const isSupported =
    typeof navigator !== "undefined" && "serial" in navigator;

  if (!isSupported) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            汽车座椅设备码生成
          </h1>
          <p className="text-muted-foreground mt-1">
            通过串口读取靠背和座椅的 MAC 地址，生成设备码字符串
          </p>
        </div>
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <WifiOff className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold mb-2">浏览器不支持</h2>
            <p className="text-muted-foreground text-sm text-center max-w-md">
              Web Serial API 需要 Chrome 89+ 或 Edge 89+ 浏览器支持。
            </p>
            <Badge variant="secondary" className="mt-4">
              推荐使用 Google Chrome 浏览器
            </Badge>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            汽车座椅设备码生成
          </h1>
          <p className="text-muted-foreground mt-1">
            依次连接靠背和座椅设备，读取 MAC 地址并生成设备码 · 波特率 1,000,000
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-sm">
            {doneCount} / 2
          </Badge>
          <ConnectionIndicator status={serialStatus} />
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-500 rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / 2) * 100}%` }}
        />
      </div>

      {/* 前缀选择 */}
      <Card className="border-border/50">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-medium text-foreground">设备码前缀：</span>
            <div className="flex gap-2">
              {PREFIX_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant={prefix === opt.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPrefix(opt.value)}
                  className={prefix === opt.value ? "bg-orange-600 hover:bg-orange-700" : ""}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              输出格式: mac地址:{prefix}-back,mac地址:{prefix}-sit
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 操作流程提示 */}
      <Card className="bg-amber-50/50 border-amber-200/50">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-6 text-sm text-amber-800 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold">
                1
              </span>
              <span>连接座椅设备</span>
            </div>
            <ChevronRight className="h-4 w-4 text-amber-400" />
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold">
                2
              </span>
              <span>点击对应插槽读取</span>
            </div>
            <ChevronRight className="h-4 w-4 text-amber-400" />
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold">
                3
              </span>
              <span>读取靠背和座椅</span>
            </div>
            <ChevronRight className="h-4 w-4 text-amber-400" />
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold">
                4
              </span>
              <span>复制设备码</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧 - 2 个座椅插槽 */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SEAT_SLOTS.map((slot) => (
            <SeatSlotCard
              key={slot}
              slot={slot}
              state={slots[slot]}
              isActive={activeSlot === slot}
              onRead={() => handleReadSlot(slot)}
              disabled={activeSlot !== null && activeSlot !== slot}
            />
          ))}
        </div>

        {/* 右侧 - 输出结果 + 日志 */}
        <div className="space-y-4">
          {/* 关联合同 */}
          <Card className="border-border/50">
            <CardContent className="pt-4">
              <ContractPicker value={contract} onChange={setContract} />
            </CardContent>
          </Card>

          {/* 输出结果 */}
          <Card
            className={`${allDone ? "border-amber-300 bg-amber-50/30" : "border-border/50"}`}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Wifi className="h-4 w-4 text-orange-500" />
                设备码输出
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre
                className={`rounded-lg p-4 text-sm font-mono leading-relaxed min-h-[80px] whitespace-pre-wrap break-all ${
                  outputString
                    ? "bg-slate-900 text-slate-50"
                    : "bg-muted/30 text-muted-foreground"
                }`}
              >
                {outputString || "读取座椅 MAC 地址后，设备码将在此显示..."}
              </pre>

              <div className="flex gap-2">
                <Button
                  onClick={handleCopy}
                  disabled={!outputString}
                  className="flex-1"
                  variant={allDone ? "default" : "outline"}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      复制设备码
                    </>
                  )}
                </Button>
                <Button onClick={handleReset} variant="outline" size="icon">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              {allDone && (
                <div className="flex items-center gap-2 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
                  <Check className="h-4 w-4 text-amber-700 shrink-0" />
                  <span className="text-sm text-amber-800 font-medium">
                    靠背和座椅 MAC 地址已全部读取完成
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 通讯日志 */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  通讯日志
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setLogs([])}
                >
                  清空
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-48 overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed">
                {logs.length === 0 ? (
                  <span className="text-slate-500">等待操作...</span>
                ) : (
                  logs.map((entry, i) => {
                    const time = new Date(entry.timestamp).toLocaleTimeString(
                      "zh-CN",
                      { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }
                    );
                    const colorMap: Record<string, string> = {
                      info: "text-slate-400",
                      error: "text-red-400",
                      data: "text-cyan-400",
                      success: "text-emerald-400",
                      warning: "text-yellow-400",
                    };
                    return (
                      <div key={i} className="flex gap-2 py-0.5">
                        <span className="text-slate-600 shrink-0">[{time}]</span>
                        <span className={colorMap[entry.type] || "text-slate-400"}>
                          {entry.message}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={logEndRef} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
