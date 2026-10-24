import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { RotateCcw, ShieldAlert } from "lucide-react";

function fmt(ts?: number | null) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("zh-CN");
}
function mask(keyString: string) {
  return keyString.length <= 6 ? keyString : "****" + keyString.slice(-6);
}

export default function TamperedKeys() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data, refetch, isLoading } = trpc.keys.tamperedList.useQuery({ page, pageSize });
  const keys = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // 吊销原因弹窗
  const [revokeTarget, setRevokeTarget] = useState<number | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  // 重签确认弹窗（点了确认才真正签发）
  const [reissueTarget, setReissueTarget] = useState<number | null>(null);
  // 重签结果弹窗
  const [reissued, setReissued] = useState<{ keyString: string; id: number } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ id: number; expireTimestamp: number } | null>(null);

  const restoreMutation = trpc.keys.clearTamper.useMutation({
    onSuccess: () => {
      toast.success("原密钥异常已清除，请客户重新校验");
      setRestoreTarget(null);
      void utils.keys.tamperedList.invalidate();
      void utils.keys.tamperedCount.invalidate();
      void utils.keys.list.invalidate();
      void utils.keys.stats.invalidate();
    },
    onError: err => toast.error(err.message || "恢复失败，请重试"),
  });

  const revokeMutation = trpc.keys.revoke.useMutation({
    onSuccess: () => {
      toast.success("密钥已吊销");
      setRevokeTarget(null);
      setRevokeReason("");
      refetch();
    },
    onError: (err) => toast.error(err.message || "吊销失败"),
  });

  const reissueMutation = trpc.keys.reissue.useMutation({
    onSuccess: (res) => {
      toast.success("已重新签发新密钥，旧密钥已吊销");
      setReissueTarget(null);
      setReissued({ keyString: res.newKey.keyString, id: res.newKey.id });
      refetch();
    },
    onError: (err) => toast.error(err.message || "重签失败"),
  });

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-6 w-6 text-red-600" />
        <h1 className="text-2xl font-bold">异常密钥管理</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>在线密钥校验时，服务端会维护每把密钥上报的"可信时间高水位"。一旦客户端时间被回拨（或客户端上报篡改），密钥会被标记为<span className="text-red-600 font-medium">异常（TAMPERED）</span>并持久化，校验一律拒绝，删除客户端本地文件也无法绕过。</p>
          <p><strong>清除异常 / 重新激活</strong>：核实客户后清除标记并重置高水位（否则客户时钟未调回会立刻又判异常）。</p>
          <p><strong>重新签发</strong>：按原传感器/天数生成一把新密钥（默认同时吊销旧 key），发给客户即恢复。</p>
          <p><strong>吊销</strong>：确认为盗用/滥用时永久作废。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>异常密钥列表（{total} 把）</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>密钥</TableHead>
                <TableHead>客户 / 备注</TableHead>
                <TableHead>传感器</TableHead>
                <TableHead>异常时间</TableHead>
                <TableHead>上报本机时间</TableHead>
                <TableHead>服务器时间</TableHead>
                <TableHead>原到期</TableHead>
                <TableHead>触发原因</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys?.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.id}</TableCell>
                  <TableCell className="font-mono text-xs">{mask(k.keyString)}</TableCell>
                  <TableCell className="text-sm">{k.customerName || k.remark || "-"}</TableCell>
                  <TableCell className="text-xs max-w-[140px] truncate" title={k.sensorType}>{k.sensorType}</TableCell>
                  <TableCell className="text-xs">{fmt(k.tamperedAt ? new Date(k.tamperedAt).getTime() : null)}</TableCell>
                  <TableCell className="text-xs text-red-600">{fmt(k.reportedClientTime)}</TableCell>
                  <TableCell className="text-xs">{fmt(k.tamperServerTime)}</TableCell>
                  <TableCell className="text-xs">{fmt(k.expireTimestamp)}</TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate" title={k.tamperReason || ""}>{k.tamperReason || "-"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" className="mr-1"
                      disabled={restoreMutation.isPending}
                      onClick={() => setRestoreTarget({ id: k.id, expireTimestamp: k.expireTimestamp })}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      恢复原密钥
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-1"
                      onClick={() => setReissueTarget(k.id)}
                    >
                      重新签发
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => { setRevokeTarget(k.id); setRevokeReason(""); }}
                    >
                      吊销
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (!keys || keys.length === 0) && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">暂无异常密钥</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">共 {total} 把，第 {page}/{totalPages} 页</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={restoreTarget !== null} onOpenChange={open => { if (!open && !restoreMutation.isPending) setRestoreTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢复原密钥 #{restoreTarget?.id}</DialogTitle>
            <DialogDescription>清除时间异常标记并重置时间高水位，不生成新密钥、不延长有效期、不修改电脑数量限制。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>原到期时间：{fmt(restoreTarget?.expireTimestamp)}</p>
            <p>核实后将恢复异常前的状态；原本已过期、暂停或吊销的密钥仍不能使用。</p>
            <p className="text-muted-foreground">请先确认客户电脑时间正确，再让客户重启软件并联网校验。旧客户端若仍提示本机时间异常，需要另外排查，不能绕过本机校验。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={restoreMutation.isPending} onClick={() => setRestoreTarget(null)}>取消</Button>
            <Button disabled={restoreTarget === null || restoreMutation.isPending}
              aria-busy={restoreMutation.isPending}
              onClick={() => { if (restoreTarget && !restoreMutation.isPending) restoreMutation.mutate({ keyId: restoreTarget.id }); }}>
              <ButtonSpinner pending={restoreMutation.isPending} />
              确认恢复原密钥
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 吊销原因弹窗 */}
      <Dialog open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>吊销密钥 #{revokeTarget}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">吊销原因 *</label>
            <Input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="如：确认盗用/滥用" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => revokeTarget && revokeMutation.mutate({ keyId: revokeTarget, reason: revokeReason })}
              disabled={!revokeReason || revokeMutation.isPending}
            >
              确认吊销
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重签确认弹窗（点确认才真正签发 + 吊销旧 key） */}
      <Dialog open={reissueTarget !== null} onOpenChange={(o) => !o && setReissueTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认重新签发？</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>将为密钥 <span className="font-mono">#{reissueTarget}</span> 生成一把<strong>全新密钥</strong>，并<strong className="text-red-600">永久吊销旧密钥 #{reissueTarget}</strong>。此操作不可撤销。</p>
            <p className="text-muted-foreground">确认后会弹出新密钥，请复制发给客户。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReissueTarget(null)}>取消</Button>
            <Button
              onClick={() => reissueTarget && reissueMutation.mutate({ keyId: reissueTarget, revokeOld: true })}
              disabled={reissueMutation.isPending}
            >
              {reissueMutation.isPending ? "签发中..." : "确认签发"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重签结果弹窗 */}
      <Dialog open={reissued !== null} onOpenChange={(o) => !o && setReissued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新密钥已签发 #{reissued?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">请把下面这把新密钥发给客户（旧密钥已吊销）：</p>
            <div className="flex gap-2">
              <Input readOnly value={reissued?.keyString || ""} className="font-mono text-xs" />
              <Button
                variant="outline"
                onClick={() => { copyText(reissued?.keyString || ""); toast.success("已复制"); }}
              >
                复制
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setReissued(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
