import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function BlacklistManagement() {
  
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ machineId: "", reason: "" });

  const { data: blacklist, refetch } = trpc.blacklist.list.useQuery();
  const exportQuery = trpc.blacklist.export.useQuery(undefined, { enabled: false });

  const addMutation = trpc.blacklist.add.useMutation({
    onSuccess: () => {
      toast.success("已添加到黑名单");
      setShowAdd(false);
      setForm({ machineId: "", reason: "" });
      refetch();
    },
    onError: (err) => toast.error("添加失败"),
  });

  const removeMutation = trpc.blacklist.remove.useMutation({
    onSuccess: () => {
      toast.success("已从黑名单移除");
      refetch();
    },
    onError: (err) => toast.error("移除失败"),
  });

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `blacklist_${result.data.version}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("黑名单已导出");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">离线黑名单管理</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>导出黑名单文件</Button>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button>添加到黑名单</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>添加机器码到黑名单</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">机器码 *</label>
                  <Input
                    value={form.machineId}
                    onChange={(e) => setForm({ ...form, machineId: e.target.value })}
                    placeholder="16位十六进制机器码"
                    maxLength={32}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">原因</label>
                  <Input
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="加入黑名单原因"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => addMutation.mutate({ machineId: form.machineId, reason: form.reason || undefined })}
                  disabled={!form.machineId || addMutation.isPending}
                >
                  {addMutation.isPending ? "添加中..." : "确认添加"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 说明卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">使用说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>离线密钥无法通过网络实时吊销，需要通过黑名单机制实现。</p>
          <p>1. 将需要吊销的机器码添加到黑名单</p>
          <p>2. 导出黑名单 JSON 文件</p>
          <p>3. 客户端软件导入黑名单文件后，会拒绝黑名单中的机器码激活</p>
        </CardContent>
      </Card>

      {/* 黑名单列表 */}
      <Card>
        <CardHeader>
          <CardTitle>黑名单列表（{blacklist?.length ?? 0} 条）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>机器码</TableHead>
                <TableHead>关联离线密钥</TableHead>
                <TableHead>原因</TableHead>
                <TableHead>添加人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blacklist?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.id}</TableCell>
                  <TableCell className="font-mono text-sm">{item.machineId}</TableCell>
                  <TableCell>{item.offlineKeyId ? `#${item.offlineKeyId}` : "-"}</TableCell>
                  <TableCell className="text-sm">{item.reason || "-"}</TableCell>
                  <TableCell>{item.addedByName || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={item.isActive ? "destructive" : "secondary"}>
                      {item.isActive ? "生效中" : "已移除"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{new Date(item.createdAt).toLocaleString("zh-CN")}</TableCell>
                  <TableCell>
                    {item.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeMutation.mutate({ id: item.id })}
                        disabled={removeMutation.isPending}
                      >
                        移除
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!blacklist || blacklist.length === 0) && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">黑名单为空</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
