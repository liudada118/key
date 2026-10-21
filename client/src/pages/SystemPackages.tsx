import { useEffect, useState } from "react";
import { PackagePlus, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { systemPackagesApi as api } from "@/lib/systemPackagesApi";
import { Link } from "wouter";

type Submission = { id: number; systemId: string; name: string; sha256: string; status: string;
  baseVersion: number | null; reviewNote: string | null; audienceJson: string | null; createdAt: string };
type WithdrawalMode = "stop-distribution" | "stop-new-acquisition";
type Detail = { withdrawal?: { mode: WithdrawalMode; reason: string } | null; id: number; systemId: string; status: string; manifest: Record<string, unknown>;
  baseVersion: number | null; currentPublished: { id: number; name: string } | null;
  diff: { dataContractChanged: boolean; protocolChanged: boolean; lineOrderChanged: boolean;
    dataContract: { before: unknown; after: unknown } | null; protocol: { before: unknown; after: unknown } | null;
    lineOrders: { path: string; beforePath: string | null; afterPath: string | null;
      before: string | null; after: string | null }[] } | null;
  versions: { id: number; name: string; publishedAt: string | null }[];
  rollouts: { customerId: number; versionId: number }[]; rolloutToken: string;
  files: { path: string; size: number; sha256: string }[]; algorithms: { id: string; name: string }[] };

/** Staff upload an Agent export; super admins review its dependencies and publish to customers. */
export default function SystemPackages() {
  const { user } = useAuth();
  const admin = user?.role === "super_admin";
  const customers = trpc.customers.all.useQuery(undefined, { enabled: admin });
  const [items, setItems] = useState<Submission[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [releaseVersion, setReleaseVersion] = useState<number | null>(null);
  const [releaseAudience, setReleaseAudience] = useState<"all" | "selected">("selected");
  const [releaseCustomers, setReleaseCustomers] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [withdrawalMode, setWithdrawalMode] = useState<WithdrawalMode>("stop-distribution");
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [publishFailure, setPublishFailure] = useState("");
  const [issuedToken, setIssuedToken] = useState("");
  const [updateConflict, setUpdateConflict] = useState<{ package: any; currentVersion: number } | null>(null);
  const [staffTokens, setStaffTokens] = useState<{ id: number; expiresAt: string; revokedAt: string | null }[]>([]);
  const defaultVersion = detail?.rollouts.find((item) => item.customerId === 0)?.versionId;

  /** Refresh only metadata; full package bytes stay on the server until a reviewer opens one item. */
  const refresh = async (silent = false) => {
    if (!admin) return;
    try { setItems((await api("/admin/submissions")).items); }
    catch (error) { if (!silent) setMessage((error as Error).message); }
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
  const upload = async (file?: File, retry?: { package: any; currentVersion: number }) => {
    if (!file && !retry) return;
    setBusy(true); setMessage("");
    try {
      if (file && file.size > 16 * 1024 * 1024) throw new Error("审核包超过 16 MiB");
      let value = retry?.package;
      try { if (file) value = JSON.parse(await file.text()); }
      catch { throw new Error("所选文件不是有效的系统审核包，请从软件 Agent 成果中重新导出"); }
      const result = await api("/submissions", { method: "POST", body: JSON.stringify({ package: value,
        ...(retry ? { baseVersion: retry.currentVersion } : {}) }) });
      setUpdateConflict(null);
      const uploaded = `系统“${result.name}”已上传${result.status === "published" ? '且已发布' : '，等待审核'}。`;
      setMessage(uploaded);
      await refresh(true);
      if (admin) {
        try {
          const opened = await api(`/admin/submissions/${result.id}`) as Detail;
          setDetail(opened); setPublishFailure(""); setReleaseVersion(opened.id); setReleaseAudience("selected"); setReleaseCustomers([]);
          requestAnimationFrame(() => document.getElementById("system-package-review")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        } catch { setMessage(`${uploaded} 审核详情暂时无法打开，请刷新列表重试。`); }
      }
    } catch (error) {
      const conflict = error as Error & { code?: string; currentVersion?: number };
      if (conflict.code === "SYSTEM_ID_ALREADY_PUBLISHED" && Number.isSafeInteger(conflict.currentVersion) && !retry) {
        let value: any;
        try { value = file ? JSON.parse(await file.text()) : null; } catch { value = null; }
        if (value) setUpdateConflict({ package: value, currentVersion: conflict.currentVersion! });
        setMessage(`系统 ID 已属于已发布版本 #${conflict.currentVersion}。确认是同一系统的更新后，才可继续提交；新系统请先更换 ID。`);
      } else setMessage(`提交失败：${conflict.code === "SYSTEM_ID_INCOMPATIBLE" ? "系统类型或原生来源与已发布版本不一致，请使用新 ID" :
        conflict.code === "SYSTEM_ID_PENDING" ? "此 ID 已有待审核提交，请先处理该版本" : conflict.message}`);
    }
    finally { setBusy(false); }
  };

  /** Review actions are explicit and update the list only after server confirmation. */
  const act = async (action: "publish" | "reject" | "revoke") => {
    if (!detail) return;
    if (action === "revoke" && !window.confirm(`处理 ${detail.systemId} 版本 #${detail.id}：${withdrawalMode === "stop-distribution" ? "停止新下载；已安装客户端在取得有效版本状态后继续使用。" : "停止新采集，正在采集的数据有序收尾，历史保留。"}离线客户端要在下次成功检查或凭证失效后才受影响。确认继续？`)) return;
    setBusy(true); setMessage(""); setPublishFailure("");
    let actionCompleted = false;
    try {
      const body = action === "publish" ? {
        ...(detail.baseVersion ? { confirmBaseVersion: detail.baseVersion } : {}) }
        : action === "reject" ? { note } : { withdrawalMode, reason: withdrawalReason };
      await api(`/admin/submissions/${detail.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      actionCompleted = true;
      setMessage(action === "publish" ? (detail.currentPublished ? `系统 ${detail.systemId} 已审核为候选版本；请在下方选择范围后推广，客户当前版本不变。` : `系统 ${detail.systemId} 已首次发布为默认版本，持相应授权密钥的客户可获取。`)
        : action === "reject" ? "已退回，原包保留供审计。" : `已保存撤回策略：${withdrawalMode === "stop-distribution" ? "停止新下载，已安装新版客户端可继续使用" : "停止新采集并有序收尾，历史保留"}。下次有效检查生效，断网电脑不能即时触达。`);
      if (action === "publish") {
        setDetail(await api(`/admin/submissions/${detail.id}`)); setReleaseVersion(detail.id);
      } else if (action === "revoke") { setDetail(await api(`/admin/submissions/${detail.id}`)); }
      else setDetail(null);
      await refresh();
    } catch (error) {
      const explanation = (error as Error).message;
      if (actionCompleted) {
        setMessage(`操作已完成，但页面未能刷新：${explanation}。请手动刷新列表核对状态。`);
        return;
      }
      if (action === "publish") setPublishFailure(explanation);
      setMessage(action === "publish" ? `发布未完成，系统仍待审核：${explanation}` : `操作失败：${explanation}`);
    }
    finally { setBusy(false); }
  };

  /** Promote or roll back an approved package without editing its signed bytes. */
  const activate = async () => {
    if (!detail || !releaseVersion || (releaseAudience === "selected" && !releaseCustomers.length)) return;
    const version = detail.versions.find((item) => item.id === releaseVersion);
    if (!version) return;
    if (releaseAudience === "all" && !window.confirm(`将“${detail.systemId}”全部客户切换到版本 #${version.id}，并清除单独指定的版本。确认继续？`)) return;
    setBusy(true); setMessage("");
    try {
      await api(`/admin/releases/${version.id}/activate`, { method: "POST", body: JSON.stringify({
        audience: releaseAudience === "all" ? "all" : releaseCustomers,
        expectedRolloutToken: detail.rolloutToken }) });
      setDetail(await api(`/admin/submissions/${detail.id}`));
      setMessage(releaseAudience === "all" ? `已将全部客户切换到版本 #${version.id}。`
        : `已将 ${releaseCustomers.length} 位客户切换到版本 #${version.id}。`);
    } catch (error) { setMessage(`版本切换失败：${(error as Error).message}。请刷新详情后重试。`); }
    finally { setBusy(false); }
  };

  return <main className="mx-auto max-w-5xl space-y-6 p-4" translate="no">
    <header className="flex items-center gap-3"><ShieldCheck className="size-6 text-primary" /><div>
      <h1 className="text-2xl font-semibold">公司系统库</h1>
      <p className="text-sm text-muted-foreground">员工提交进入审核；首次发布建立默认版本，后续更新审核成候选，显式推广后客户才切换。软件仍凭密钥授权获取系统。</p>
    </div></header>
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-medium">软件直接提交凭证</h2>
      <p className="text-sm text-muted-foreground">员工登录管理网站后签发。此令牌可提交待审系统、读取公司已发布的原包用于创建修订草稿；不能批准发布或下载客户系统。</p>
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
        setUpdateConflict(null); void upload(event.target.files?.[0]); event.target.value = "";
      }} />
      {updateConflict && <button type="button" disabled={busy} className="ml-3 rounded-md border px-3 py-2 text-sm"
        onClick={() => void upload(undefined, updateConflict)}>确认作为版本 #{updateConflict.currentVersion} 的更新提交</button>}
    </section>
    {message && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{message}</p>}
    {admin && <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-medium">审核与发布</h2>
        <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void refresh()}><RefreshCw className="mr-2 inline size-4" />刷新</button></div>
      <div className="space-y-2">{items.map((item) => <button type="button" key={item.id}
        className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted"
        onClick={async () => { try { const opened = await api(`/admin/submissions/${item.id}`) as Detail;
          setDetail(opened); setPublishFailure(""); setReleaseVersion(opened.status === "published" ? opened.id : opened.currentPublished?.id || null);
          setReleaseAudience("selected"); setReleaseCustomers([]);
          setNote(""); setWithdrawalMode(opened.withdrawal?.mode ?? "stop-distribution"); setWithdrawalReason(opened.withdrawal?.reason ?? ""); } catch (error) { setMessage((error as Error).message); } }}>
        <span><strong>{item.name}</strong><small className="ml-2 text-muted-foreground">#{item.id} · {item.systemId}{item.baseVersion ? ` · 更新 #${item.baseVersion}` : " · 新系统"}</small></span>
        <span className="text-sm">{item.status === "pending" ? "待审核" : item.status === "published" ? "已发布" : item.status === "revoked" ? "已撤回" : "已退回"}</span>
      </button>)}{!items.length && <p className="text-sm text-muted-foreground">暂无提交</p>}</div>
    </section>}
    {admin && detail && <section id="system-package-review" className="space-y-4 rounded-xl border bg-card p-5" aria-label="系统包审核详情">
      <div className="flex items-center justify-between"><h2 className="text-lg font-medium">{detail.systemId} · #{detail.id}</h2>
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={async () => {
          try { setDetail(await api(`/admin/submissions/${detail.id}`)); setPublishFailure(""); } catch (error) { setMessage((error as Error).message); }
        }} className="rounded-md border px-3 py-1">刷新详情</button>
          <button type="button" onClick={() => setDetail(null)} className="rounded-md border px-3 py-1">关闭</button></div></div>
      <p className="text-sm">{detail.files.length} 个配置文件；{detail.algorithms.length} 个分类算法。请核对矩阵、协议和线序后发布。</p>
      <p className="text-sm font-medium">{detail.baseVersion ? `更新系统：基于已发布版本 #${detail.baseVersion}（${detail.currentPublished?.name || "原系统"}）` : "新系统首次发布"}
        {detail.currentPublished && detail.currentPublished.id !== detail.baseVersion ? `；当前最新版本已变为 #${detail.currentPublished.id}，请退回并重新提交` : ""}</p>
      {detail.diff && <div className="space-y-2 rounded-lg border p-3 text-sm">
        <strong>相对版本 #{detail.baseVersion} 的变更</strong>
        <p className={detail.diff.dataContractChanged ? "text-destructive" : "text-muted-foreground"}>
          传感器 ID、类型、输出通道及矩阵尺寸：{detail.diff.dataContractChanged ? "已改变，不能沿用同一系统 ID 发布" : "保持兼容"}</p>
        {detail.diff.dataContractChanged && <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(detail.diff.dataContract, null, 2)}</pre>}
        <p>串口协议：{detail.diff.protocolChanged ? "已改变，请确认接收点数和解析规则" : "无变化"}</p>
        {detail.diff.protocolChanged && <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(detail.diff.protocol, null, 2)}</pre>}
        <p>展示线序：{detail.diff.lineOrderChanged ? "已改变，请核对原始点到矩阵的映射" : "无变化"}</p>
        {detail.diff.lineOrders.map((item) => <p key={item.path} className="font-mono text-xs">{item.path} · {item.beforePath || "无"} ({item.before?.slice(0, 12) || "无"}) → {item.afterPath || "无"} ({item.after?.slice(0, 12) || "无"})</p>)}
      </div>}
      <div className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-2 font-medium">配置</h3><pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(detail.manifest, null, 2)}</pre></div>
        <div><h3 className="mb-2 font-medium">文件与算法</h3><div className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">
          {detail.files.map((file) => <p key={file.path}>{file.path} · {file.size} B · {file.sha256.slice(0, 12)}</p>)}
          {detail.algorithms.map((algorithm) => <p key={algorithm.id}>算法：{algorithm.name} ({algorithm.id})</p>)}
        </div></div></div>
      {detail.status === "pending" && <>
        <div className="rounded-lg border bg-muted p-3 text-sm" role="note">
          {detail.currentPublished ? <><strong>审核通过后仅形成候选版本</strong><p>本次不会切换任何客户的版本。发布后请使用“版本推广与客户回退”指定客户或全体范围。</p></>
            : <><strong>首次发布建立默认版本</strong><p>影响范围：所有密钥已授权此系统且没有专属版本指针的客户；本次不需要额外选择客户。</p></>}
          <p>已有客户专属指针：{detail.rollouts.filter(item => item.customerId !== 0).length} 位；当前默认：{defaultVersion ? `#${defaultVersion}` : detail.currentPublished ? `发布时固定为 #${detail.currentPublished.id}` : "本次首次发布版本"}。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={busy || Boolean(detail.diff?.dataContractChanged)
          || (detail.currentPublished?.id ?? null) !== detail.baseVersion}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" onClick={() => void act("publish")}>{detail.baseVersion ? `审核为 #${detail.baseVersion} 的候选更新` : "确认发布新系统"}</button>
          <input className="rounded-md border px-3 py-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="退回原因（可选）" />
          <button type="button" disabled={busy} className="rounded-md border px-4 py-2" onClick={() => void act("reject")}>退回</button></div>
        {publishFailure && <div role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <strong className="block">发布未完成，系统仍待审核</strong>
          <p className="mt-1">{publishFailure}</p>
        </div>}
      </>}
      {["published", "revoked"].includes(detail.status) && <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="font-medium">撤回此确切版本（{detail.systemId} · #{detail.id}）</legend>
        <label className="block text-sm"><input type="radio" name="withdrawal-mode" checked={withdrawalMode === "stop-distribution"} onChange={() => setWithdrawalMode("stop-distribution")} /> 停止交付：禁止新下载，已安装客户端取得有效版本状态后继续使用（默认）。</label>
        <label className="block text-sm"><input type="radio" name="withdrawal-mode" checked={withdrawalMode === "stop-new-acquisition"} onChange={() => setWithdrawalMode("stop-new-acquisition")} /> 停止采集：禁止新采集，当前采集有序收尾；历史查看和回放保留。</label>
        <label className="block text-sm">撤回原因（可选）<input maxLength={400} className="mt-1 block w-full rounded border p-2" value={withdrawalReason} onChange={event => setWithdrawalReason(event.target.value)} /></label>
        <p className="text-xs text-muted-foreground">不改变同系统其他版本；不会自动切旧版。离线电脑不能即时触达。旧客户端仍按原目录规则保守限制，应先验证目标安装包支持所选策略。</p>
        <button type="button" disabled={busy} className="rounded-md border px-4 py-2" onClick={() => void act("revoke")}>{detail.status === "revoked" ? "确认调整此版本撤回策略" : "确认撤回此版本"}</button>
      </fieldset>}
      {detail.status === "published" && <>
        <div className="flex flex-wrap items-center gap-3"><Link href={`/generate?system=${encodeURIComponent(detail.systemId)}`} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">开密钥时选择此系统</Link>
</div>
        <section className="space-y-3 rounded-lg border p-4" aria-label="系统版本发布范围">
          <h3 className="font-medium">版本推广与客户回退</h3>
          <p className="text-sm font-medium">本版本状态：{detail.rollouts.some(item => item.versionId === detail.id) ? "已用于交付" : "候选版本，尚未显式推广"}</p>
          <p className="text-sm text-muted-foreground">客户关联仅用于版本推广和回退。软件凭有效密钥中的系统授权获取；未关联客户时，使用全体默认版本，历史系统未设置默认时仍沿用旧兼容规则；升级前应运行默认基线回填，后续审核不会自动推广。</p>
          <p className="text-sm">全体默认版本：{defaultVersion ? `#${defaultVersion}` : "最新已发布版本"}；单独指定客户：{detail.rollouts.filter((item) => item.customerId !== 0).length} 位</p>
          <label className="block text-sm">目标版本
            <select className="ml-2 rounded border bg-background p-2" value={releaseVersion ?? ""} onChange={(event) => setReleaseVersion(Number(event.target.value))}>
              {detail.versions.map((item) => <option key={item.id} value={item.id}>#{item.id} · {item.name}</option>)}
            </select>
          </label>
          <fieldset className="space-y-2"><legend className="text-sm">目标范围</legend>
            <label className="mr-5 text-sm"><input type="radio" checked={releaseAudience === "selected"} onChange={() => setReleaseAudience("selected")} /> 指定客户</label>
            <label className="text-sm"><input type="radio" checked={releaseAudience === "all"} onChange={() => setReleaseAudience("all")} /> 全部客户（清除单独指定）</label>
            {releaseAudience === "selected" && <div className="max-h-40 overflow-auto rounded border p-3">{customers.data?.map((item) => <label key={item.id} className="mr-5 block py-1 text-sm">
              <input type="checkbox" checked={releaseCustomers.includes(item.id)} onChange={(event) => setReleaseCustomers((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /> {item.name} (#{item.id}) · 当前 {detail.rollouts.find((row) => row.customerId === item.id)?.versionId ?? detail.rollouts.find((row) => row.customerId === 0)?.versionId ?? "最新已发布版本"}
            </label>)}</div>}
          </fieldset>
          <button type="button" disabled={busy || !releaseVersion || (releaseAudience === "selected" && !releaseCustomers.length)}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" onClick={() => void activate()}>
            {releaseAudience === "all" ? `将全部客户切换到 #${releaseVersion ?? "?"}` : `将 ${releaseCustomers.length} 位客户切换到 #${releaseVersion ?? "?"}`}
          </button>
        </section>
      </>}
    </section>}
  </main>;
}
