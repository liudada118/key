import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Copy, Download, KeyRound, Loader2, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function GenerateKey() {
  const { data: sensorTypes } = trpc.keys.sensorTypes.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">生成密钥</h1>
        <p className="text-muted-foreground mt-1">创建量产密钥或在线租赁密钥</p>
      </div>

      <Tabs defaultValue="single" className="space-y-4">
        <TabsList className="bg-secondary">
          <TabsTrigger value="single">单个生成</TabsTrigger>
          <TabsTrigger value="batch">批量生成</TabsTrigger>
        </TabsList>

        <TabsContent value="single">
          <SingleGenerate sensorTypes={sensorTypes || []} />
        </TabsContent>
        <TabsContent value="batch">
          <BatchGenerate sensorTypes={sensorTypes || []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type SensorType = { label: string; value: string };

function SingleGenerate({ sensorTypes }: { sensorTypes: readonly SensorType[] }) {
  const [sensorType, setSensorType] = useState("");
  const [category, setCategory] = useState<"production" | "rental">("production");
  const [days, setDays] = useState("365");
  const [remark, setRemark] = useState("");
  const [result, setResult] = useState<{ keyString: string; expireTimestamp: number } | null>(null);

  const generateMutation = trpc.keys.generate.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success("密钥生成成功");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleGenerate = () => {
    if (!sensorType) return toast.error("请选择传感器类型");
    if (!days || parseInt(days) < 1) return toast.error("请输入有效的天数");
    generateMutation.mutate({
      sensorType,
      days: parseInt(days),
      category,
      remark: remark || undefined,
    });
  };

  const copyKey = () => {
    if (result) {
      navigator.clipboard.writeText(result.keyString);
      toast.success("密钥已复制到剪贴板");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <KeyRound className="h-4 w-4 text-primary" />
            密钥参数
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-foreground">密钥类型</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as "production" | "rental")}>
              <SelectTrigger className="bg-secondary/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">量产密钥</SelectItem>
                <SelectItem value="rental">在线租赁密钥</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">传感器类型</Label>
            <Select value={sensorType} onValueChange={setSensorType}>
              <SelectTrigger className="bg-secondary/50">
                <SelectValue placeholder="选择传感器类型" />
              </SelectTrigger>
              <SelectContent>
                {sensorTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">有效期（天）</Label>
            <Input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="bg-secondary/50"
              placeholder="输入有效期天数"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">备注（可选）</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="bg-secondary/50 resize-none"
              placeholder="输入备注信息"
              rows={2}
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="w-full"
            size="lg"
          >
            {generateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            生成密钥
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">生成结果</CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">密钥字符串</Label>
                <div className="relative">
                  <div className="p-4 bg-secondary/50 rounded-lg font-mono text-sm break-all text-foreground border border-border/50">
                    {result.keyString}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={copyKey}
                    className="absolute top-2 right-2"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <p className="text-muted-foreground text-xs">密钥类型</p>
                  <p className="font-medium text-foreground mt-0.5">
                    {category === "production" ? "量产密钥" : "在线租赁密钥"}
                  </p>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <p className="text-muted-foreground text-xs">有效期</p>
                  <p className="font-medium text-foreground mt-0.5">{days} 天</p>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <p className="text-muted-foreground text-xs">传感器类型</p>
                  <p className="font-medium text-foreground mt-0.5">
                    {sensorTypes.find((t) => t.value === sensorType)?.label || sensorType}
                  </p>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg">
                  <p className="text-muted-foreground text-xs">到期时间</p>
                  <p className="font-medium text-foreground mt-0.5">
                    {new Date(result.expireTimestamp).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <KeyRound className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">生成的密钥将显示在这里</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BatchGenerate({ sensorTypes }: { sensorTypes: readonly SensorType[] }) {
  const [sensorType, setSensorType] = useState("");
  const [category, setCategory] = useState<"production" | "rental">("production");
  const [days, setDays] = useState("365");
  const [count, setCount] = useState("10");
  const [remark, setRemark] = useState("");
  const [results, setResults] = useState<{ batchId: string; keys: { keyString: string }[]; count: number } | null>(null);

  const batchMutation = trpc.keys.batchGenerate.useMutation({
    onSuccess: (data) => {
      setResults(data);
      toast.success(`成功生成 ${data.count} 个密钥`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleBatch = () => {
    if (!sensorType) return toast.error("请选择传感器类型");
    if (!days || parseInt(days) < 1) return toast.error("请输入有效的天数");
    if (!count || parseInt(count) < 1) return toast.error("请输入生成数量");
    batchMutation.mutate({
      sensorType,
      days: parseInt(days),
      category,
      count: parseInt(count),
      remark: remark || undefined,
    });
  };

  const copyAll = () => {
    if (results) {
      const text = results.keys.map((k) => k.keyString).join("\n");
      navigator.clipboard.writeText(text);
      toast.success("所有密钥已复制到剪贴板");
    }
  };

  const downloadCSV = () => {
    if (!results) return;
    const sensorLabel = sensorTypes.find((t) => t.value === sensorType)?.label || sensorType;
    const catLabel = category === "production" ? "量产密钥" : "在线租赁密钥";
    const header = "序号,密钥,传感器类型,密钥类型,有效期天数";
    const rows = results.keys.map(
      (k, i) => `${i + 1},${k.keyString},${sensorLabel},${catLabel},${days}`
    );
    const csv = "\uFEFF" + header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keys_batch_${results.batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV 文件已下载");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Zap className="h-4 w-4 text-primary" />
            批量参数
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-foreground">密钥类型</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as "production" | "rental")}>
              <SelectTrigger className="bg-secondary/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">量产密钥</SelectItem>
                <SelectItem value="rental">在线租赁密钥</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">传感器类型</Label>
            <Select value={sensorType} onValueChange={setSensorType}>
              <SelectTrigger className="bg-secondary/50">
                <SelectValue placeholder="选择传感器类型" />
              </SelectTrigger>
              <SelectContent>
                {sensorTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-foreground">有效期（天）</Label>
              <Input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground">生成数量</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="bg-secondary/50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">备注（可选）</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="bg-secondary/50 resize-none"
              placeholder="输入备注信息"
              rows={2}
            />
          </div>

          <Button
            onClick={handleBatch}
            disabled={batchMutation.isPending}
            className="w-full"
            size="lg"
          >
            {batchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            批量生成
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base font-medium text-foreground">批量结果</CardTitle>
          {results && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={copyAll}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                复制全部
              </Button>
              <Button size="sm" variant="outline" onClick={downloadCSV}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                下载 CSV
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {results ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>批次号: {results.batchId}</span>
                <span>共 {results.count} 个密钥</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto space-y-1.5 pr-1">
                {results.keys.map((k, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 bg-secondary/30 rounded-lg group"
                  >
                    <span className="text-xs text-muted-foreground w-8 shrink-0 text-right">
                      {i + 1}.
                    </span>
                    <span className="font-mono text-xs break-all flex-1 text-foreground">
                      {k.keyString}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 h-7 w-7 p-0"
                      onClick={() => {
                        navigator.clipboard.writeText(k.keyString);
                        toast.success("已复制");
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <Zap className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">批量生成的密钥将显示在这里</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
