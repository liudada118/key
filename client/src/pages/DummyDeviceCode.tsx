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
} from "lucide-react";
import { toast } from "sonner";
import {
  serialMacService,
  type ConnectionStatus,
  type MacResult,
  type LogEntry,
} from "@/lib/SerialMacService";

// ===== 假人插槽定义 =====
type DummySlot = "jacket" | "leftHand" | "rightHand" | "leftFoot" | "rightFoot";

interface SlotState {
  label: string;
  mac: string | null;
  status: "empty" | "reading" | "done";
  timestamp?: number;
}

const DUMMY_SLOTS: DummySlot[] = ["jacket", "leftHand", "rightHand", "leftFoot", "rightFoot"];

const SLOT_LABELS: Record<DummySlot, string> = {
  jacket: "上衣",
  leftHand: "左手",
  rightHand: "右手",
  leftFoot: "左脚",
  rightFoot: "右脚",
};

const SLOT_ICONS: Record<DummySlot, string> = {
  jacket: "👕",
  leftHand: "🤚",
  rightHand: "✋",
  leftFoot: "🦶",
  rightFoot: "🦶",
};

const SLOT_SUFFIXES: Record<DummySlot, string> = {
  jacket: "jacket",
  leftHand: "leftHand",
  rightHand: "rightHand",
  leftFoot: "leftFoot",
  rightFoot: "rightFoot",
};

const SLOT_COLORS: Record<DummySlot, { bg: string; border: string; text: string; ring: string }> = {
  jacket: {
    bg: "bg-purple-50",
    border: "border-purple-200",
    text: "text-purple-700",
    ring: "ring-purple-400",
  },
  leftHand: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    ring: "ring-blue-400",
  },
  rightHand: {
    bg: "bg-cyan-50",
    border: "border-cyan-200",
    text: "text-cyan-700",
    ring: "ring-cyan-400",
  },
  leftFoot: {
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    ring: "ring-green-400",
  },
  rightFoot: {
    bg: "bg-teal-50",
    border: "border-teal-200",
    text: "text-teal-700",
    ring: "ring-teal-400",
  },
};

// 前缀选项
type PrefixOption = "endi" | "carY";

const PREFIX_OPTIONS: { value: PrefixOption; label: string }[] = [
  { value: "endi", label: "endi" },
  { value: "carY", label: "carY" },
];

// 假人固定波特率（与坐垫相同）
const DUMMY_BAUD_RATE = 1000000;

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
function DummySlotCard({
  slot,
  state,
  isActive,
  onRead,
  disabled,
}: {
  slot: DummySlot;
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
              <p className="text-xs text-muted-foreground">{SLOT_SUFFIXES[slot]}</p>
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
export default function DummyDeviceCode() {
  const [slots, setSlots] = useState<Record<DummySlot, SlotState>>({
    jacket: { label: "上衣", mac: null, status: "empty" },
    leftHand: { label: "左手", mac: null, status: "empty" },
    rightHand: { label: "右手", mac: null, status: "empty" },
    leftFoot: { label: "左脚", mac: null, status: "empty" },
    rightFoot: { label: "右脚", mac: null, status: "empty" },
  });
  const [activeSlot, setActiveSlot] = useState<DummySlot | null>(null);
  const [serialStatus, setSerialStatus] = useState<ConnectionStatus>("disconnected");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [prefix, setPrefix] = useState<PrefixOption>("endi");
  const logEndRef = useRef<HTMLDivElement>(null);
  const macCallbackRef = useRef<((result: MacResult) => void) | null>(null);

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
    async (slot: DummySlot) => {
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

        // 读取完成后自动断开
        try {
          await serialMacService.disconnect();
        } catch (_) {}
      };

      // 假人使用固定波特率 1000000 连接
      const success = await serialMacService.connect(DUMMY_BAUD_RATE);
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
      }
    },
    []
  );

  // 生成输出字符串
  const outputString = useMemo(() => {
    const parts = DUMMY_SLOTS.map((slot) => {
      const mac = slots[slot].mac;
      if (!mac) return null;
      return `${mac}:${prefix}-${SLOT_SUFFIXES[slot]}`;
    }).filter(Boolean);
    return parts.join(",");
  }, [slots, prefix]);

  // 已完成的数量
  const doneCount = DUMMY_SLOTS.filter((s) => slots[s].status === "done").length;
  const allDone = doneCount === 5;

  // 复制输出
  const handleCopy = useCallback(async () => {
    if (!outputString) {
      toast.error("请先读取至少一个假人设备的 MAC 地址");
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
      jacket: { label: "上衣", mac: null, status: "empty" },
      leftHand: { label: "左手", mac: null, status: "empty" },
      rightHand: { label: "右手", mac: null, status: "empty" },
      leftFoot: { label: "左脚", mac: null, status: "empty" },
      rightFoot: { label: "右脚", mac: null, status: "empty" },
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
            假人设备码生成
          </h1>
          <p className="text-muted-foreground mt-1">
            通过串口读取假人各部位的 MAC 地址，生成设备码字符串
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
            假人设备码生成
          </h1>
          <p className="text-muted-foreground mt-1">
            依次连接假人各部位设备，读取 MAC 地址并生成设备码 · 波特率 1,000,000
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-sm">
            {doneCount} / 5
          </Badge>
          <ConnectionIndicator status={serialStatus} />
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / 5) * 100}%` }}
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
                  className={prefix === opt.value ? "bg-purple-600 hover:bg-purple-700" : ""}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground ml-auto">
              输出格式: mac地址:{prefix}-jacket, mac地址:{prefix}-leftHand, ...
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 操作流程提示 */}
      <Card className="bg-purple-50/50 border-purple-200/50">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-4 text-sm text-purple-800 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold">
                1
              </span>
              <span>连接假人设备</span>
            </div>
            <ChevronRight className="h-4 w-4 text-purple-400" />
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold">
                2
              </span>
              <span>点击对应部位读取</span>
            </div>
            <ChevronRight className="h-4 w-4 text-purple-400" />
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold">
                3
              </span>
              <span>依次读取5个部位</span>
            </div>
            <ChevronRight className="h-4 w-4 text-purple-400" />
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold">
                4
              </span>
              <span>复制设备码</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧 - 5 个假人插槽 */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DUMMY_SLOTS.map((slot) => (
            <DummySlotCard
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
          {/* 输出结果 */}
          <Card
            className={`${allDone ? "border-purple-300 bg-purple-50/30" : "border-border/50"}`}
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Wifi className="h-4 w-4 text-purple-500" />
                设备码输出
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre
                className={`rounded-lg p-4 text-sm font-mono leading-relaxed min-h-[120px] whitespace-pre-wrap break-all ${
                  outputString
                    ? "bg-slate-900 text-slate-50"
                    : "bg-muted/30 text-muted-foreground"
                }`}
              >
                {outputString || "读取假人各部位 MAC 地址后，设备码将在此显示..."}
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
                <div className="flex items-center gap-2 bg-purple-100 border border-purple-200 rounded-lg px-3 py-2">
                  <Check className="h-4 w-4 text-purple-700 shrink-0" />
                  <span className="text-sm text-purple-800 font-medium">
                    假人 5 个部位 MAC 地址已全部读取完成
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
