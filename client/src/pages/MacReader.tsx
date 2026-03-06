import { useState, useRef, useEffect } from "react";
import { useSerialMac } from "@/hooks/useSerialMac";
import { BAUD_RATES } from "@/lib/SerialMacService";
import type { ConnectionStatus, LogEntry, MacResult, DetectResult } from "@/lib/SerialMacService";
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
  Plus,
  Power,
  PowerOff,
  Radar,
  ScrollText,
  Send,
  Terminal,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";

// Status indicator
function StatusIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; pulse: boolean; label: string }> = {
    disconnected: { color: "bg-muted-foreground", pulse: false, label: "未连接" },
    connecting: { color: "bg-yellow-500", pulse: true, label: "连接中..." },
    detecting: { color: "bg-blue-500", pulse: true, label: "探测中..." },
    connected: { color: "bg-emerald-500", pulse: false, label: "已连接" },
    reading: { color: "bg-yellow-500", pulse: true, label: "读取 MAC..." },
    error: { color: "bg-destructive", pulse: false, label: "连接错误" },
  };

  const c = config[status];

  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {c.pulse && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.color} opacity-75`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c.color}`} />
      </span>
      <span className="text-sm font-medium text-foreground">{c.label}</span>
    </div>
  );
}

// Device category badge
function DeviceBadge({ result }: { result: DetectResult }) {
  const colorMap: Record<string, string> = {
    hand: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    sit: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    foot: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    unknown: "bg-muted text-muted-foreground border-border",
  };

  return (
    <div className="flex items-center gap-2">
      <Badge className={`${colorMap[result.deviceCategory] || colorMap.unknown} border text-xs`}>
        {result.deviceLabel}
      </Badge>
      <span className="text-xs text-muted-foreground font-mono">
        @ {result.baudRate.toLocaleString()}
      </span>
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
function MacResultCard({ result, index }: { result: MacResult; index: number }) {
  const time = new Date(result.timestamp).toLocaleString("zh-CN", { hour12: false });

  const categoryColor: Record<string, string> = {
    hand: "border-purple-500/30",
    sit: "border-blue-500/30",
    foot: "border-emerald-500/30",
    unknown: "border-border/50",
  };

  const copyId = () => {
    navigator.clipboard.writeText(result.uniqueId).then(() => {
      toast.success("已复制 Unique ID");
    });
  };

  return (
    <Card
      className={`${categoryColor[result.deviceCategory] || categoryColor.unknown} hover:border-primary/30 transition-colors`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs text-muted-foreground">
              #{String(index + 1).padStart(2, "0")}
            </span>
            <Badge
              variant="secondary"
              className="text-[10px] h-4 px-1.5"
            >
              {result.deviceLabel}
            </Badge>
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
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0" onClick={copyId}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-3 gap-2 text-[11px]">
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
          <div>
            <span className="text-muted-foreground/60">设备类型</span>
            <div className="font-mono text-foreground/80 mt-0.5">{result.deviceLabel}</div>
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
    detectResult,
    baudCandidates,
    autoDetectConnect,
    connect,
    disconnect,
    readMac,
    sendCustomCommand,
    clearLogs,
    clearResults,
    addBaudCandidate,
    removeBaudCandidate,
    isSupported,
  } = useSerialMac();

  const [customCmd, setCustomCmd] = useState("");
  const [connectMode, setConnectMode] = useState<"auto" | "manual">("auto");
  const [newBaudRate, setNewBaudRate] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const isConnected = status === "connected" || status === "reading";
  const isReading = status === "reading";
  const isBusy = status === "connecting" || status === "detecting";

  const handleAutoConnect = async () => {
    const success = await autoDetectConnect();
    if (success) toast.success("设备识别并连接成功");
  };

  const handleManualConnect = async () => {
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

  const handleAddBaudRate = () => {
    const rate = parseInt(newBaudRate);
    if (isNaN(rate) || rate <= 0) {
      toast.error("请输入有效的波特率数值");
      return;
    }
    if (baudCandidates.includes(rate)) {
      toast.error("该波特率已存在");
      return;
    }
    addBaudCandidate(rate, "unknown", `自定义 (${rate})`);
    setNewBaudRate("");
    toast.success(`已添加波特率 ${rate.toLocaleString()}`);
  };

  // Unsupported browser
  if (!isSupported) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">MAC 地址读取</h1>
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">MAC 地址读取</h1>
          <p className="text-muted-foreground mt-1">
            自动识别波特率与设备类型，读取硬件 Unique ID
          </p>
        </div>
        <div className="flex items-center gap-3">
          {detectResult && <DeviceBadge result={detectResult} />}
          <StatusIndicator status={status} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left - Controls */}
        <div className="lg:col-span-4 space-y-4">
          {/* Connection Panel */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
                <Cable className="h-4 w-4 text-primary" />
                串口连接
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode Switch */}
              <div className="flex rounded-lg bg-secondary/30 border border-border/30 p-1">
                <button
                  onClick={() => setConnectMode("auto")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    connectMode === "auto"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  disabled={isConnected || isBusy}
                >
                  <Radar className="h-3 w-3 inline mr-1" />
                  自动探测
                </button>
                <button
                  onClick={() => setConnectMode("manual")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    connectMode === "manual"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  disabled={isConnected || isBusy}
                >
                  <Cable className="h-3 w-3 inline mr-1" />
                  手动连接
                </button>
              </div>

              {connectMode === "auto" ? (
                <>
                  {/* Baud candidates list */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      探测波特率列表（按顺序尝试）
                    </label>
                    <div className="space-y-1.5">
                      {baudCandidates.map((rate) => (
                        <div
                          key={rate}
                          className="flex items-center justify-between rounded-md bg-secondary/20 border border-border/30 px-3 py-1.5"
                        >
                          <span className="font-mono text-xs text-foreground">
                            {rate.toLocaleString()}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {rate === 921600
                                ? "手套"
                                : rate === 1000000
                                  ? "坐垫"
                                  : rate === 3000000
                                    ? "脚垫"
                                    : "自定义"}
                            </span>
                            <button
                              onClick={() => removeBaudCandidate(rate)}
                              className="text-muted-foreground/50 hover:text-destructive transition-colors"
                              disabled={isConnected || isBusy}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Add new baud rate */}
                    <div className="flex gap-2 mt-2">
                      <Input
                        value={newBaudRate}
                        onChange={(e) => setNewBaudRate(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddBaudRate()}
                        placeholder="添加波特率..."
                        className="font-mono text-xs"
                        disabled={isConnected || isBusy}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAddBaudRate}
                        disabled={isConnected || isBusy || !newBaudRate.trim()}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Auto Connect */}
                  {!isConnected ? (
                    <Button onClick={handleAutoConnect} disabled={isBusy} className="w-full" size="lg">
                      {isBusy ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {status === "detecting" ? "正在探测波特率..." : "连接中..."}
                        </>
                      ) : (
                        <>
                          <Radar className="h-4 w-4 mr-2" />
                          自动探测连接
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
                </>
              ) : (
                <>
                  {/* Manual Baud Rate */}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      波特率 (Baud Rate)
                    </label>
                    <Select
                      value={String(baudRate)}
                      onValueChange={(v) => setBaudRate(Number(v))}
                      disabled={isConnected || isBusy}
                    >
                      <SelectTrigger className="font-mono text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BAUD_RATES.map((rate) => (
                          <SelectItem key={rate} value={String(rate)} className="font-mono">
                            {rate.toLocaleString()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Manual Connect */}
                  {!isConnected ? (
                    <Button
                      onClick={handleManualConnect}
                      disabled={isBusy}
                      className="w-full"
                      size="lg"
                    >
                      {isBusy ? (
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
                </>
              )}

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
                    正在读取 MAC（最长 60 秒）...
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
                <label className="text-xs text-muted-foreground mb-1.5 block">自定义指令</label>
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
                  <Badge
                    variant="secondary"
                    className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0"
                  >
                    1
                  </Badge>
                  <span>
                    选择<strong>自动探测</strong>模式（推荐）或手动指定波特率
                  </span>
                </div>
                <div className="flex gap-2">
                  <Badge
                    variant="secondary"
                    className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0"
                  >
                    2
                  </Badge>
                  <span>点击连接，在弹窗中选择设备</span>
                </div>
                <div className="flex gap-2">
                  <Badge
                    variant="secondary"
                    className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0"
                  >
                    3
                  </Badge>
                  <span>
                    自动探测会依次尝试候选波特率，检测分隔符 <code className="text-primary">AA 55 03 99</code> 识别设备
                  </span>
                </div>
                <div className="flex gap-2">
                  <Badge
                    variant="secondary"
                    className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0"
                  >
                    4
                  </Badge>
                  <span>点击"读取 MAC 地址"发送 AT 指令（最长等待 60 秒）</span>
                </div>
                <div className="flex gap-2">
                  <Badge
                    variant="secondary"
                    className="h-5 w-5 p-0 flex items-center justify-center text-[10px] shrink-0"
                  >
                    5
                  </Badge>
                  <span>可在探测列表中添加/删除自定义波特率</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right - Results & Logs */}
        <div className="lg:col-span-8 space-y-4">
          {/* Detect Result Banner */}
          {detectResult && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Radar className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">设备已识别</p>
                    <p className="text-xs text-muted-foreground">
                      波特率 {detectResult.baudRate.toLocaleString()} · 类型: {detectResult.deviceLabel}
                    </p>
                  </div>
                </div>
                <DeviceBadge result={detectResult} />
              </CardContent>
            </Card>
          )}

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
