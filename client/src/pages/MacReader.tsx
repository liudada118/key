import { useState, useRef, useEffect } from "react";
import { useSerialMac } from "@/hooks/useSerialMac";
import { BAUD_RATES, DEFAULT_BAUD_RATE } from "@/lib/SerialMacService";
import type { ConnectionStatus, LogEntry, MacResult } from "@/lib/SerialMacService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Cable,
  CircleDot,
  Copy,
  Cpu,
  Loader2,
  MonitorSmartphone,
  Play,
  Power,
  PowerOff,
  ScrollText,
  Send,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";

// Status indicator
function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; pulse: boolean; label: string }> = {
    disconnected: { color: "bg-muted-foreground", pulse: false, label: "未连接" },
    connecting: { color: "bg-yellow-500", pulse: true, label: "连接中..." },
    connected: { color: "bg-emerald-500", pulse: false, label: "已连接" },
    reading: { color: "bg-yellow-500", pulse: true, label: "读取中..." },
    error: { color: "bg-destructive", pulse: false, label: "连接错误" },
  };

  const c = config[status];

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {c.pulse && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.color} opacity-75`} />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c.color}`} />
      </span>
      <span className="text-sm font-medium text-foreground">{c.label}</span>
    </div>
  );
}

// Log line
function LogLine({ entry }: { entry: LogEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const colorMap: Record<LogEntry["type"], string> = {
    info: "text-muted-foreground",
    error: "text-destructive",
    data: "text-chart-1",
    success: "text-chart-2",
    warning: "text-yellow-500",
  };

  return (
    <div className="flex gap-2 py-0.5 font-mono text-[11px] leading-relaxed">
      <span className="text-muted-foreground/50 shrink-0">[{time}]</span>
      <span className={colorMap[entry.type]}>{entry.message}</span>
    </div>
  );
}

// MAC result card
function MacResultCard({
  result,
  index,
}: {
  result: MacResult;
  index: number;
}) {
  const time = new Date(result.timestamp).toLocaleString("zh-CN", { hour12: false });

  const copyId = () => {
    navigator.clipboard.writeText(result.uniqueId).then(() => {
      toast.success("已复制 Unique ID");
    });
  };

  return (
    <Card className="border-border/50 hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs text-muted-foreground">
              #{String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/60 font-mono">{time}</span>
        </div>

        {/* Unique ID */}
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-1">
            Unique ID (MAC)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={copyId}
              className="font-mono text-base font-bold text-primary tracking-wider hover:text-primary/80 transition-colors text-left break-all"
              title="点击复制"
            >
              {result.uniqueId}
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 shrink-0"
              onClick={copyId}
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-muted-foreground/60">固件版本</span>
            <div className="font-mono text-foreground/80 mt-0.5">{result.version}</div>
          </div>
          <div>
            <span className="text-muted-foreground/60">波特率</span>
            <div className="font-mono text-foreground/80 mt-0.5">
              {result.baudRate.toLocaleString()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MacReader() {
  const {
    status,
    logs,
    macResults,
    baudRate,
    setBaudRate,
    connect,
    disconnect,
    readMac,
    sendCustomCommand,
    clearLogs,
    clearResults,
    isSupported,
  } = useSerialMac();

  const [customCmd, setCustomCmd] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const isConnected = status === "connected" || status === "reading";
  const isReading = status === "reading";
  const isConnecting = status === "connecting";

  const handleConnect = async () => {
    const success = await connect(baudRate);
    if (success) toast.success("串口连接成功");
  };

  const handleDisconnect = async () => {
    await disconnect();
    toast.info("串口已断开");
  };

  const handleReadMac = async () => {
    await readMac();
  };

  const handleSendCustom = async () => {
    if (!customCmd.trim()) return;
    await sendCustomCommand(customCmd.trim());
    setCustomCmd("");
  };

  // Unsupported browser
  if (!isSupported) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            MAC 地址读取
          </h1>
          <p className="text-muted-foreground mt-1">
            通过 Web Serial API 读取硬件设备 MAC 地址
          </p>
        </div>
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <WifiOff className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">浏览器不支持</h2>
            <p className="text-muted-foreground text-sm text-center max-w-md">
              Web Serial API 需要 Chrome 89+ 或 Edge 89+ 浏览器支持。请使用兼容的浏览器打开此页面。
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            MAC 地址读取
          </h1>
          <p className="text-muted-foreground mt-1">
            通过 Web Serial API 读取硬件设备 Unique ID
          </p>
        </div>
        <StatusIndicator status={status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left - Controls */}
        <div className="lg:col-span-4 space-y-4">
          {/* Connection Panel */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                <Cable className="h-4 w-4 text-primary" />
                串口配置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Baud Rate */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  波特率 (Baud Rate)
                </label>
                <Select
                  value={String(baudRate)}
                  onValueChange={(v) => setBaudRate(Number(v))}
                  disabled={isConnected || isConnecting}
                >
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BAUD_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)} className="font-mono">
                        {rate.toLocaleString()}
                        {rate === DEFAULT_BAUD_RATE ? " (默认)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Serial Info */}
              <div className="rounded-lg bg-secondary/30 border border-border/30 p-3">
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <span className="text-muted-foreground/60 block mb-0.5">数据位</span>
                    <span className="font-mono text-foreground/80">8</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground/60 block mb-0.5">停止位</span>
                    <span className="font-mono text-foreground/80">1</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground/60 block mb-0.5">校验位</span>
                    <span className="font-mono text-foreground/80">None</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground/60 block mb-0.5">AT 指令</span>
                    <span className="font-mono text-foreground/80 text-[10px]">
                      AT+NAME=ESP32
                    </span>
                  </div>
                </div>
              </div>

              {/* Connect / Disconnect */}
              {!isConnected ? (
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="w-full"
                  size="lg"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      连接中...
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4 mr-2" />
                      连接串口
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleDisconnect}
                  variant="destructive"
                  className="w-full"
                  size="lg"
                >
                  <PowerOff className="h-4 w-4 mr-2" />
                  断开连接
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Actions Panel */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                <Play className="h-4 w-4 text-primary" />
                操作
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Read MAC */}
              <Button
                onClick={handleReadMac}
                disabled={!isConnected || isReading}
                variant="secondary"
                className="w-full"
                size="lg"
              >
                {isReading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    正在读取 MAC 地址...
                  </>
                ) : (
                  <>
                    <Cpu className="h-4 w-4 mr-2" />
                    读取 MAC 地址
                  </>
                )}
              </Button>

              {/* Custom Command */}
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  自定义指令
                </label>
                <div className="flex gap-2">
                  <Input
                    value={customCmd}
                    onChange={(e) => setCustomCmd(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendCustom()}
                    placeholder="输入 AT 指令..."
                    disabled={!isConnected}
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={handleSendCustom}
                    disabled={!isConnected || !customCmd.trim()}
                    size="sm"
                    variant="outline"
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Usage Guide */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                <MonitorSmartphone className="h-4 w-4 text-primary" />
                使用说明
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-[11px] text-muted-foreground leading-relaxed">
                <div className="flex gap-2">
                  <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0">
                    1
                  </Badge>
                  <span>选择波特率（默认 3,000,000）</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0">
                    2
                  </Badge>
                  <span>点击"连接串口"，在弹窗中选择设备</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0">
                    3
                  </Badge>
                  <span>点击"读取 MAC 地址"发送 AT 指令</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0">
                    4
                  </Badge>
                  <span>等待设备返回 Unique ID 信息</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right - Results & Logs */}
        <div className="lg:col-span-8 space-y-4">
          {/* MAC Results */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                  <CircleDot className="h-4 w-4 text-primary" />
                  读取结果
                  {macResults.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {macResults.length}
                    </Badge>
                  )}
                </CardTitle>
                {macResults.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={clearResults}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    清空
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {macResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Cpu className="h-12 w-12 mb-3 opacity-20" />
                  <p className="text-sm">暂无读取结果</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    连接设备后点击"读取 MAC 地址"
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {macResults.map((result, i) => (
                    <MacResultCard key={result.timestamp + "-" + i} result={result} index={i} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Log Panel */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                  <Terminal className="h-4 w-4 text-primary" />
                  通信日志
                </CardTitle>
                {logs.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={clearLogs}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    清空
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] overflow-y-auto rounded-lg bg-secondary/20 border border-border/30 p-3">
                {logs.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <ScrollText className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="font-mono text-[11px] text-muted-foreground/40">
                        $ 等待操作...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    {logs.map((entry, i) => (
                      <LogLine key={i} entry={entry} />
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
