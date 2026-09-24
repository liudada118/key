import { useEffect, useState } from "react";
import { PackagePlus, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

type Submission = { id: number; systemId: string; name: string; sha256: string; status: string;
  reviewNote: string | null; audienceJson: string | null; createdAt: string };
type Detail = { id: number; systemId: string; status: string; manifest: Record<string, unknown>;
  files: { path: string; size: number; sha256: string }[]; algorithms: { id: string; name: string }[] };

/** Send an authenticated review request and surface the server's stable error. */
async function api(path: string, options?: RequestInit) {
  const response = await fetch(`/api/system-packages${path}`, {
    credentials: "same-origin", ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

/** Staff upload an Agent export; super admins review its dependencies and publish to customers. */
export default function SystemPackages() {
  const { user } = useAuth();
  const admin = user?.role === "super_admin";
  const customers = trpc.customers.all.useQuery(undefined, { enabled: admin });
  const [items, setItems] = useState<Submission[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [audience, setAudience] = useState<"all" | "selected">("selected");
  const [selectedCustomers, setSelectedCustomers] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [staffTokens, setStaffTokens] = useState<{ id: number; expiresAt: string; revokedAt: string | null }[]>([]);

  /** Refresh only metadata; full package bytes stay on the server until a reviewer opens one item. */
  const refresh = async () => {
    if (!admin) return;
    try { setItems((await api("/admin/submissions")).items); }
    catch (error) { setMessage((error as Error).message); }
  };
  useEffect(() => { void refresh(); }, [admin]);
  useEffect(() => { void api("/staff-tokens").then((value) => setStaffTokens(value.tokens)).catch(() => {}); }, []);

  /** Show the scoped token only once so the employee can save it in the desktop Agent. */
  const issueToken = async () => {
    setBusy(true);
    try {
      const value = await api("/staff-tokens", { method: "POST", body: "{}" });
      setIssuedToken(value.token);
      setStaffTokens((current) => [{ id: value.id, expiresAt: value.expiresAt, revokedAt: null }, ...current]);
      setMessage("员工令牌已签发；请复制到软件 Agent → 模型设置 → 公司系统提交。关闭此页后不再显示原文。");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  /** The browser session identifies the employee; the software key never grants upload rights. */
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("审核包超过 16 MiB");
      const value = JSON.parse(await file.text());
      const result = await api("/submissions", { method: "POST", body: JSON.stringify({ package: value }) });
      setMessage(`已提交审核 #${result.id}；管理员批准后才会提供给客户。`);
      await refresh();
    } catch (error) { setMessage(`提交失败：${(error as Error).message}`); }
    finally { setBusy(false); }
  };

  /** Review actions are explicit and update the list only after server confirmation. */
  const act = async (action: "publish" | "reject" | "revoke") => {
    if (!detail) return;
    setBusy(true); setMessage("");
    try {
      const body = action === "publish" ? { audience: audience === "all" ? "all" : selectedCustomers }
        : action === "reject" ? { note } : {};
      await api(`/admin/submissions/${detail.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      setMessage(action === "publish" ? `系统 ${detail.systemId} 已发布，客户下次同步后可用。`
        : action === "reject" ? "已退回，原包保留供审计。" : "已撤回，客户下次同步后停止授权。");
      setDetail(null); await refresh();
    } catch (error) { setMessage(`操作失败：${(error as Error).message}`); }
    finally { setBusy(false); }
  };

  return <main className="mx-auto max-w-5xl space-y-6 p-4" translate="no">
    <header className="flex items-center gap-3"><ShieldCheck className="size-6 text-primary" /><div>
      <h1 className="text-2xl font-semibold">公司系统库</h1>
      <p className="text-sm text-muted-foreground">员工提交只进入审核队列；发布后按客户授权自动交付。</p>
    </div></header>
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-medium">软件直接提交凭证</h2>
      <p className="text-sm text-muted-foreground">员工登录管理网站后签发。此令牌只能提交待审系统，不能批准发布或下载客户系统。</p>
      <button type="button" disabled={busy} className="rounded-md border px-3 py-2 text-sm" onClick={() => void issueToken()}>生成 30 天员工令牌</button>
      {issuedToken && <div className="flex flex-wrap items-center gap-2"><input className="min-w-0 flex-1 rounded border p-2 font-mono text-xs" aria-label="新员工令牌" readOnly value={issuedToken} />
        <button type="button" className="rounded border px-3 py-2" onClick={() => void navigator.clipboard.writeText(issuedToken)}>复制</button></div>}
      {!!staffTokens.length && <div className="space-y-1 text-xs text-muted-foreground">{staffTokens.map((item) => <div key={item.id} className="flex items-center justify-between gap-2">
        <span>#{item.id} · {item.revokedAt ? "已撤销" : `到期 ${new Date(item.expiresAt).toLocaleDateString("zh-CN")}`}</span>
        {!item.revokedAt && <button type="button" className="rounded border px-2 py-1" onClick={async () => { await api(`/staff-tokens/${item.id}`, { method: "DELETE" }); setStaffTokens((current) => current.map((token) => token.id === item.id ? { ...token, revokedAt: new Date().toISOString() } : token)); }}>撤销</button>}
      </div>)}</div>}
    </section>
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center gap-2 font-medium"><PackagePlus className="size-5" />提交 Agent 系统包</div>
      <p className="mb-3 text-sm text-muted-foreground">在软件 Agent 成果中导出审核包，再选择该 JSON 文件。采集数据和聊天记录不会进入系统包。</p>
      <input type="file" accept="application/json,.json" disabled={busy} aria-label="选择系统审核包" onChange={(event) => {
        void upload(event.target.files?.[0]); event.target.value = "";
      }} />
    </section>
    {message && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{message}</p>}
    {admin && <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-medium">审核与发布</h2>
        <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void refresh()}><RefreshCw className="mr-2 inline size-4" />刷新</button></div>
      <div className="space-y-2">{items.map((item) => <button type="button" key={item.id}
        className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted"
        onClick={async () => { try { setDetail(await api(`/admin/submissions/${item.id}`)); setNote(""); } catch (error) { setMessage((error as Error).message); } }}>
        <span><strong>{item.name}</strong><small className="ml-2 text-muted-foreground">#{item.id} · {item.systemId}</small></span>
        <span className="text-sm">{item.status === "pending" ? "待审核" : item.status === "published" ? "已发布" : item.status === "revoked" ? "已撤回" : "已退回"}</span>
      </button>)}{!items.length && <p className="text-sm text-muted-foreground">暂无提交</p>}</div>
    </section>}
    {admin && detail && <section className="space-y-4 rounded-xl border bg-card p-5" aria-label="系统包审核详情">
      <div className="flex items-center justify-between"><h2 className="text-lg font-medium">{detail.systemId} · #{detail.id}</h2>
        <button type="button" onClick={() => setDetail(null)} className="rounded-md border px-3 py-1">关闭</button></div>
      <p className="text-sm">{detail.files.length} 个配置文件；{detail.algorithms.length} 个分类算法。请核对矩阵、协议和线序后发布。</p>
      <div className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-2 font-medium">配置</h3><pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(detail.manifest, null, 2)}</pre></div>
        <div><h3 className="mb-2 font-medium">文件与算法</h3><div className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
          {detail.files.map((file) => <p key={file.path}>{file.path} · {file.size} B · {file.sha256.slice(0, 12)}</p>)}
          {detail.algorithms.map((algorithm) => <p key={algorithm.id}>算法：{algorithm.name} ({algorithm.id})</p>)}
        </div></div></div>
      {detail.status === "pending" && <>
        <fieldset className="space-y-2"><legend className="font-medium">发布范围</legend>
          <label className="mr-5"><input type="radio" checked={audience === "all"} onChange={() => setAudience("all")} /> 全部客户</label>
          <label><input type="radio" checked={audience === "selected"} onChange={() => setAudience("selected")} /> 指定客户</label>
          {audience === "selected" && <div className="max-h-40 overflow-auto rounded border p-3">{customers.data?.map((item) => <label key={item.id} className="mr-5 block py-1">
            <input type="checkbox" checked={selectedCustomers.includes(item.id)} onChange={(event) => setSelectedCustomers((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /> {item.name} (#{item.id})
          </label>)}</div>}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy || (audience === "selected" && !selectedCustomers.length)}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" onClick={() => void act("publish")}>确认发布</button>
          <input className="rounded-md border px-3 py-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="退回原因（可选）" />
          <button type="button" disabled={busy} className="rounded-md border px-4 py-2" onClick={() => void act("reject")}>退回</button></div>
      </>}
      {detail.status === "published" && <button type="button" disabled={busy} className="rounded-md border px-4 py-2" onClick={() => void act("revoke")}>撤回此版本</button>}
    </section>}
  </main>;
}
