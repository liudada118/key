import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/** Manage activation slots independently from license expiry and system authorization. */
export default function LicenseDevicesDialog({ keyId, onClose, keyType = "online" }: { keyId: number | null; onClose: () => void; keyType?: "online" | "offline" }) {
  const [limit, setLimit] = useState("0"), [error, setError] = useState("");
  const utils = trpc.useUtils();
  const query = trpc.keys.devices.useQuery({ keyId: keyId!, keyType }, { enabled: keyId !== null });
  useEffect(() => { if (query.data) setLimit(String(query.data.maxDevices)); }, [query.data]);
  const save = trpc.keys.setDeviceLimit.useMutation({ onSuccess: () => {
    setError("");
    void query.refetch();
    void utils.keys.list.invalidate();
    void utils.offlineKeys.list.invalidate();
    void utils.offlineKeys.stats.invalidate();
  }, onError: err => setError(err.message) });
  const change = trpc.keys.changeDevice.useMutation({ onSuccess: () => { setError(""); void query.refetch(); }, onError: err => setError(err.message) });
  const pending = save.isPending || change.isPending;
  return <Dialog open={keyId !== null} onOpenChange={open => { if (!open) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>密钥 #{keyId} · 电脑授权</DialogTitle></DialogHeader>
    <Label htmlFor="license-device-limit">最多可用电脑数</Label>
    <Input id="license-device-limit" type="number" min="0" max="10000" value={limit} onChange={event => setLimit(event.target.value)} disabled={pending} />
    <p className="text-sm text-muted-foreground">0 表示不限量。同一台电脑升级不重复占名额。解绑后，已离线的电脑最迟在 7 天授权凭证到期后停止使用。</p>
    <Button disabled={pending || query.isLoading} onClick={() => {
      const value = Number(limit);
      if (!limit.trim() || !Number.isInteger(value) || value < 0 || value > 10000) { setError("请输入 0–10000 的整数，0 表示不限量。"); return; }
      save.mutate({ keyId: keyId!, keyType, maxDevices: value });
    }}>{save.isPending ? "保存中…" : "保存上限"}</Button>
    {(error || query.error) && <p role="alert" className="text-sm text-destructive">{error || query.error?.message}</p>}
    {query.isLoading ? <p role="status">正在读取已登记电脑…</p> : <div className="space-y-3 max-h-64 overflow-auto">
      {query.data?.devices.length === 0 && <p className="text-sm text-muted-foreground">尚无电脑登记。新版软件联网验证密钥时登记。</p>}
      {query.data?.devices.map(device => <div key={device.id} className="flex items-center justify-between gap-3 rounded border p-3">
        <div><p>电脑 · {device.deviceId.slice(-8)} · {device.status === "active" ? "已授权" : "已解绑"}</p>
          <p className="text-xs text-muted-foreground">最近验证：{new Date(device.lastSeenAt).toLocaleString("zh-CN")}</p></div>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => change.mutate({ keyId: keyId!, keyType, deviceId: device.deviceId, status: device.status === "active" ? "revoked" : "active" })}>{device.status === "active" ? "解绑" : "恢复"}</Button>
      </div>)}
    </div>}
  </DialogContent></Dialog>;
}
