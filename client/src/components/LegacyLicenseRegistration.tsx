import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

type Preview = { keyHash: string; sensorType: string; expireTimestamp: number; outcome: "DRY_RUN" | "EXISTS" | "REGISTERED"; applied: boolean; keyId: number | null };

/** Present an explicit reviewed registration without changing the original key, scope, or validity. */
export function LegacyLicenseRegistrationView({ reason, confirmed, preview, busy, error, completed, onReason, onConfirmed, onPreview, onRegister }:
  { reason: string; confirmed: boolean; preview: Preview | null; busy: boolean; error: string; completed: boolean;
    onReason: (value: string) => void; onConfirmed: (value: boolean) => void; onPreview: () => void; onRegister: () => void }) {
  return <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4" aria-label="登记旧密钥">
    <div><h3 className="font-medium">登记旧密钥，客户无需换密钥</h3>
      <p className="mt-1 text-sm text-muted-foreground">仅超级管理员可操作。先核对原签发记录，再保留原授权范围和到期时间登记；电脑数量默认不限量。</p></div>
    <label className="block text-sm" htmlFor="legacy-key-review">签发来源审核依据</label>
    <Textarea id="legacy-key-review" value={reason} onChange={event => onReason(event.target.value)} disabled={busy || completed}
      maxLength={500} placeholder="例如：已核对原签发台账及客户交付记录。不要在此填写密钥。" aria-describedby="legacy-key-help" />
    <p id="legacy-key-help" className="text-sm text-muted-foreground">已有暂停、吊销或异常记录不会被覆盖或恢复。</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview && <dl className="space-y-1 rounded-md bg-background/70 p-3 text-sm break-words" aria-label="旧密钥登记预览">
      <div><dt className="inline text-muted-foreground">指纹：</dt><dd className="inline font-mono">{preview.keyHash.slice(-12)}</dd></div>
      <div><dt className="inline text-muted-foreground">授权范围：</dt><dd className="inline">{preview.sensorType}</dd></div>
      <div><dt className="inline text-muted-foreground">原到期时间：</dt><dd className="inline">{new Date(preview.expireTimestamp).toLocaleString("zh-CN")}</dd></div>
    </dl>}
    {completed || preview?.outcome === "EXISTS"
      ? <p role="status" className="text-sm text-chart-2">{completed ? "原密钥已登记。请客户联网重新验证原密钥，无需更换。" : "此密钥已登记，原有配置保持不变。请客户重新验证。"}</p>
      : <>
        <Button type="button" variant="outline" onClick={onPreview} disabled={busy || reason.trim().length < 5}>{busy ? "处理中…" : "预览登记信息"}</Button>
        {preview && <div className="space-y-3 border-t border-border pt-3">
          <label className="flex items-start gap-3 text-sm cursor-pointer"><Checkbox checked={confirmed} onCheckedChange={value => onConfirmed(value === true)} disabled={busy} className="mt-0.5" />
            我已核对原签发记录，确认登记上述原密钥。</label>
          <Button type="button" onClick={onRegister} disabled={busy || !confirmed}>确认登记原密钥</Button>
        </div>}
      </>}
  </section>;
}

/** Keep the reviewed fingerprint tied to the exact input; edits require another preview. */
export default function LegacyLicenseRegistration({ keyString, onRegistered }: { keyString: string; onRegistered: () => Promise<void> }) {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(""), [completed, setCompleted] = useState(false);
  const previewRequest = trpc.legacyLicenseImport.preview.useMutation(), registerRequest = trpc.legacyLicenseImport.register.useMutation();
  useEffect(() => { setPreview(null); setConfirmed(false); setError(""); setCompleted(false); }, [keyString]);
  /** Show the same safe error next to the action instead of relying on a transient toast. */
  async function previewRegistration() {
    setError(""); setConfirmed(false);
    try { setPreview(await previewRequest.mutateAsync({ keyString, reason })); }
    catch (failure) { setPreview(null); setError(failure instanceof Error ? failure.message : "登记预览失败，请重试。"); }
  }
  /** Register only the reviewed key, then refresh the existing verification result. */
  async function register() {
    if (!preview || !confirmed) return;
    setError("");
    try {
      const result = await registerRequest.mutateAsync({ keyString, reason, confirmedKeyHash: preview.keyHash, confirmation: "REGISTER_REVIEWED_LEGACY_KEY" });
      setPreview(result); setCompleted(result.applied); await onRegistered();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "登记失败，请重试。"); }
  }
  return <LegacyLicenseRegistrationView reason={reason} confirmed={confirmed} preview={preview} completed={completed} error={error}
    busy={previewRequest.isPending || registerRequest.isPending} onReason={value => { setReason(value); setPreview(null); setConfirmed(false); }}
    onConfirmed={setConfirmed} onPreview={previewRegistration} onRegister={register} />;
}
