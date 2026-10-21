import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, PackagePlus, RefreshCw } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Product = {
  id: string; name: string; summary: string; task: string; deliveryType: "local" | "cloud" | "custom";
  seller: { name: string; kind: "self" | "invited" }; version: string; versionId?: number; packageId: string | null;
  compatibility: { matrixTotals: number[]; sensorTypes: string[] }; inputs: string; outputs: string;
  evidence: string; limitations: string; support: string; pricing: { mode: "manual_quote" };
};
type Submission = { id: number; product: Product; status: string; submittedById: number; reviewNote?: string | null };
type RequestItem = { id: number; kind: string; goal: string; status: string; customerId: number; productId: string; versionId: number };
type Order = { id: number; customerId: number; productId: string; versionId: number; status: string;
  amountMinor: number; currency: string; deviceLimit: number; expiresAt: string | null; receiptReference?: string | null; deliveryReference?: string | null };
export type AlgorithmWorkspace = { submissions: Submission[]; requests: RequestItem[]; orders: Order[];
  capabilities: { review: boolean; finance: boolean }; customers: { id: number; name: string }[] };

const EMPTY_WORKSPACE: AlgorithmWorkspace = { submissions: [], requests: [], orders: [], capabilities: { review: false, finance: false }, customers: [] };
const STATUS: Record<string, string> = { pending: "待审核", rejected: "已退回", published: "已发布", requested: "待跟进", reviewing: "跟进中",
  quoted: "已报价，待收款", payment_confirmed: "已确认收款，待交付", delivered: "已登记交付", cancelled: "已取消" };
const DELIVERY: Record<string, string> = { local: "本机算法包", cloud: "云端服务", custom: "定制服务" };
const KIND: Record<string, string> = { quote: "报价申请", trial: "试用申请", custom: "定制需求" };

/** 按十进制字符串转为整数分，拒绝负数、小数溢出和不明确的金额。 */
export function parseAlgorithmAmount(value: string): number {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("金额须为非负数，最多两位小数。");
  const amount = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("金额超出可处理范围。");
  return amount;
}

/** 只提交商品公开说明，不将源码、模型或客户原始数据附到商品元数据。 */
export function algorithmProductInput(fields: Record<string, string>): Product {
  const matrixTotals = fields.matrixTotals.trim() ? fields.matrixTotals.split(/[,，\s]+/).map(Number) : [];
  if (matrixTotals.some((value) => !Number.isInteger(value) || value < 1 || value > 65536) || new Set(matrixTotals).size !== matrixTotals.length) {
    throw new Error("矩阵点数须为不重复的 1～65536 整数，以逗号分隔。");
  }
  return { id: fields.id.trim(), name: fields.name.trim(), summary: fields.summary.trim(), task: fields.task.trim(),
    deliveryType: fields.deliveryType as Product["deliveryType"], seller: { name: fields.sellerName.trim(), kind: fields.sellerKind as Product["seller"]["kind"] },
    version: fields.version.trim(), packageId: fields.packageId.trim() || null,
    compatibility: { matrixTotals, sensorTypes: fields.sensorTypes.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean) },
    inputs: fields.inputs.trim(), outputs: fields.outputs.trim(), evidence: fields.evidence.trim(), limitations: fields.limitations.trim(),
    support: fields.support.trim(), pricing: { mode: "manual_quote" } };
}

/** 固定同站接口并提供可见错误，HTML 回退不会作为成功数据进入工作台。 */
async function api<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/algorithm-platform${route}`, { credentials: "same-origin",
    method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!(response.headers.get("content-type") || "").includes("application/json")) throw new Error("算法平台接口尚未部署，请更新服务端后重试。");
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || value.error || `操作失败（HTTP ${response.status}）`);
  return value as T;
}

/** 显示不可变商品声明，审批前能够核对输入、证据与支持范围。 */
function ProductDetails({ product }: { product: Product }) {
  return <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer py-1 font-medium">查看商品声明与证据</summary>
    <dl className="mt-3 grid gap-2 break-words sm:grid-cols-2">
      {[["目标任务", product.task], ["输入要求", product.inputs], ["输出含义", product.outputs], ["效果证据", product.evidence],
        ["适用限制", product.limitations], ["支持承诺", product.support], ["点数范围", product.compatibility.matrixTotals.join("、") || "未声明"],
        ["传感器范围", product.compatibility.sensorTypes.join("、") || "未声明"]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap">{value || "未声明"}</dd></div>)}
    </dl>
  </details>;
}

/** 员工提交、独立审核及人工交易工作台；所有完成状态以服务端回执为准。 */
export default function AlgorithmPlatform({ initialWorkspace }: { initialWorkspace?: AlgorithmWorkspace } = {}) {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState(initialWorkspace || EMPTY_WORKSPACE);
  const [tab, setTab] = useState("products"), [busy, setBusy] = useState(""), [loading, setLoading] = useState(!initialWorkspace);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [references, setReferences] = useState<Record<number, string>>({});
  const [selectedRequest, setSelectedRequest] = useState("");
  const actionLock = useRef(false);

  /** 只替换成功读取的工作台，读取失败时保留上次内容并明确提示。 */
  const refresh = useCallback(async () => {
    const result = await api<AlgorithmWorkspace>("/admin/workspace");
    setWorkspace(result);
  }, []);
  useEffect(() => {
    let disposed = false;
    void refresh().catch((cause) => { if (!disposed) setError((cause as Error).message); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [refresh]);

  /** 一次写入只执行一次，回执成功但刷新失败时仍保留真实完成提示。 */
  const act = async (key: string, operation: () => Promise<unknown>, success: string) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(key); setError(""); setMessage("");
    try {
      await operation(); setMessage(success);
      try { await refresh(); } catch (cause) { setError(`操作已完成，列表刷新失败：${(cause as Error).message}`); }
    } catch (cause) { setError((cause as Error).message); }
    finally { actionLock.current = false; setBusy(""); }
  };
  const customerName = (id: number) => workspace.customers.find((customer) => customer.id === id)?.name || `客户 #${id}`;

  /** 将页面字段转换成版本提交，提交不会直接发布或安装执行。 */
  const submitProduct = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void act("submit", () => api("/submissions", { product: algorithmProductInput(fields) }), "商品版本已提交，等待独立审核；提交不代表已安装或已验证算法效果。");
  };

  /** 报价冻结当前版本、金额与使用范围，收款和交付仍需分别登记。 */
  const createOrder = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act("quote", async () => {
      const deviceLimit = Number(data.get("deviceLimit"));
      if (!Number.isSafeInteger(deviceLimit) || deviceLimit < 1) throw new Error("授权电脑数量须为正整数。");
      const expiry = String(data.get("expiresAt") || "");
      const expiresAt = expiry ? new Date(expiry).toISOString() : null;
      return api("/admin/orders", { requestId: Number(data.get("requestId")), amountMinor: parseAlgorithmAmount(String(data.get("amount"))),
        currency: String(data.get("currency")), deviceLimit, expiresAt, terms: String(data.get("terms")) });
    }, "报价订单已创建；尚未确认收款，不会授予算法使用权。");
  };

  return <main className="mx-auto max-w-6xl space-y-5 p-4" translate="no">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><PackagePlus className="mt-1 size-6 shrink-0 text-primary" aria-hidden="true" /><div>
        <h1 className="text-2xl font-semibold">算法平台</h1><p className="mt-1 text-sm text-muted-foreground">先审核商品，再人工报价、确认收款与记录交付。商品上架、收款和算法实际运行分别核对。</p>
      </div></div>
      <Button variant="outline" disabled={Boolean(busy) || loading} onClick={() => void act("refresh", refresh, "工作台已刷新。")}><RefreshCw className="size-4" aria-hidden="true" />刷新</Button>
    </header>
    {error && <div role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive whitespace-pre-wrap break-words">{error}</div>}
    {message && <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">{message}</p>}
    {loading && <p role="status" className="text-muted-foreground">正在读取算法工作台…</p>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto flex flex-wrap justify-start gap-1">
        <TabsTrigger value="products">商品与审核 · {workspace.submissions.length}</TabsTrigger>
        <TabsTrigger value="requests">客户申请 · {workspace.requests.length}</TabsTrigger>
        <TabsTrigger value="orders">订单与交付 · {workspace.orders.length}</TabsTrigger>
      </TabsList>
      <TabsContent value="products" className="space-y-5">
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-semibold"><PackagePlus className="size-4" aria-hidden="true" />提交商品版本</h2>
          <p className="mt-1 text-sm text-muted-foreground">只提交公开说明与兼容条件，不上传源码、模型或客户原始数据。修改执行版本须重新提交审核。</p>
          <form onSubmit={submitProduct} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">商品 ID<Input name="id" required maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" placeholder="例如 posture-recognition" /></label>
            <label className="grid gap-1 text-sm">商品名称<Input name="name" required maxLength={160} /></label>
            <label className="grid gap-1 text-sm">执行版本<Input name="version" required defaultValue="1.0.0" maxLength={40} /></label>
            <label className="grid gap-1 text-sm">交付方式<select name="deliveryType" className="min-h-10 rounded-md border bg-background px-3" defaultValue="local"><option value="local">本机算法包</option><option value="cloud">云端服务</option><option value="custom">定制服务</option></select></label>
            <label className="grid gap-1 text-sm">卖家名称<Input name="sellerName" required maxLength={160} defaultValue={user?.name || user?.username || ""} /></label>
            <label className="grid gap-1 text-sm">卖家关系<select name="sellerKind" className="min-h-10 rounded-md border bg-background px-3" defaultValue="self"><option value="self">公司自营</option><option value="invited">邀请开发者</option></select></label>
            <label className="grid gap-1 text-sm">本机包 ID（可选）<Input name="packageId" maxLength={100} /></label>
            <label className="grid gap-1 text-sm">支持矩阵点数（逗号分隔）<Input name="matrixTotals" placeholder="例如 529,1024" maxLength={200} /></label>
            <label className="grid gap-1 text-sm sm:col-span-2">传感器型号（可选，逗号分隔）<Input name="sensorTypes" maxLength={500} /></label>
            {[["summary", "商品简介"], ["task", "目标任务"], ["inputs", "输入要求与数据语义"], ["outputs", "输出含义与失败状态"],
              ["evidence", "效果证据与验证方法"], ["limitations", "已知限制与不适用场景"], ["support", "支持责任与联系办法"]].map(([name, label]) => <label key={name} className="grid gap-1 text-sm sm:col-span-2">{label}<Textarea name={name} required maxLength={4000} rows={2} /></label>)}
            <div className="sm:col-span-2"><Button type="submit" disabled={Boolean(busy) || loading}>{busy === "submit" ? "正在提交…" : "提交审核"}</Button></div>
          </form>
        </section>
        <section className="space-y-3" aria-label="商品审核列表"><h2 className="font-semibold">提交与审核记录</h2>
          {!workspace.submissions.length && !loading && <p className="rounded-lg border p-4 text-sm text-muted-foreground">暂无提交。填写上方商品声明后提交审核。</p>}
          {workspace.submissions.map((item) => <article key={item.id} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.product.name} · {item.product.version}</strong><span className="text-sm">{STATUS[item.status] || item.status}</span></div>
            <p className="text-sm text-muted-foreground">{item.product.id} · {DELIVERY[item.product.deliveryType]} · {item.product.seller.name}（{item.product.seller.kind === "self" ? "自营" : "邀请开发者"}） · 提交人 #{item.submittedById}</p>
            <p className="text-sm whitespace-pre-wrap">{item.product.summary}</p><ProductDetails product={item.product} />
            {item.reviewNote && <p className="text-sm">审核说明：{item.reviewNote}</p>}
            {item.status === "pending" && workspace.capabilities.review && <div className="space-y-2">
              {item.submittedById === user?.id && <p className="text-sm text-muted-foreground">此版本由你提交，请由另一位有审核权限的人员复核。</p>}
              <label className="grid gap-1 text-sm">审核说明<Textarea value={reviewNotes[item.id] || ""} onChange={(event) => setReviewNotes((previous) => ({ ...previous, [item.id]: event.target.value }))} maxLength={2000} /></label>
              <div className="flex flex-wrap gap-2"><Button disabled={Boolean(busy) || item.submittedById === user?.id || !reviewNotes[item.id]?.trim()} onClick={() => void act(`review-${item.id}`, () => api(`/admin/submissions/${item.id}/review`, { decision: "publish", note: reviewNotes[item.id] || "" }), "商品版本已审核发布到目录；安装执行与效果仍需实际验证。")}><ClipboardCheck className="size-4" aria-hidden="true" />审核发布</Button>
                <Button variant="outline" disabled={Boolean(busy) || item.submittedById === user?.id || !reviewNotes[item.id]?.trim()} onClick={() => void act(`review-${item.id}`, () => api(`/admin/submissions/${item.id}/review`, { decision: "reject", note: reviewNotes[item.id] || "" }), "已退回该版本，原提交与审核记录保留。")}>退回并说明原因</Button></div>
            </div>}
          </article>)}
        </section>
      </TabsContent>
      <TabsContent value="requests" className="space-y-3">
        <p className="text-sm text-muted-foreground">试用申请只是准备记录，不消耗正式试用次数，也不代表已经执行或效果通过。</p>
        {!workspace.requests.length && !loading && <p className="rounded-lg border p-4 text-sm text-muted-foreground">暂无客户申请。客户可在软件算法市场申请报价、试用或提交定制目标。</p>}
        {workspace.requests.map((item) => <article key={item.id} className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap justify-between gap-2"><strong>#{item.id} · {KIND[item.kind] || item.kind} · {customerName(item.customerId)}</strong><span className="text-sm">{STATUS[item.status] || item.status}</span></div>
          <p className="text-sm text-muted-foreground">{item.productId} · 版本 #{item.versionId}</p><p className="whitespace-pre-wrap break-words text-sm">{item.goal}</p>
          {workspace.capabilities.finance && item.status !== "cancelled" && <Button variant="outline" disabled={Boolean(busy)} onClick={() => { setSelectedRequest(String(item.id)); setTab("orders"); }}>为此申请创建报价</Button>}
        </article>)}
      </TabsContent>
      <TabsContent value="orders" className="space-y-5">
        {workspace.capabilities.finance ? <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">创建人工报价</h2>
          <form onSubmit={createOrder} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-2">客户申请<select name="requestId" value={selectedRequest} onChange={(event) => setSelectedRequest(event.target.value)} required className="min-h-10 rounded-md border bg-background px-3"><option value="">选择申请</option>{workspace.requests.filter((request) => request.status !== "cancelled").map((request) => <option key={request.id} value={request.id}>#{request.id} · {customerName(request.customerId)} · {request.productId}</option>)}</select></label>
            <label className="grid gap-1 text-sm">报价金额<Input name="amount" inputMode="decimal" required placeholder="0.00" /></label>
            <label className="grid gap-1 text-sm">币种<select name="currency" className="min-h-10 rounded-md border bg-background px-3"><option value="CNY">CNY · 人民币</option><option value="USD">USD · 美元</option></select></label>
            <label className="grid gap-1 text-sm">授权电脑数量<Input name="deviceLimit" type="number" min="1" step="1" required defaultValue="1" /></label>
            <label className="grid gap-1 text-sm">使用权截止时间（留空按报价约定）<Input name="expiresAt" type="datetime-local" /></label>
            <label className="grid gap-1 text-sm sm:col-span-2">完整报价、许可与验收条款<Textarea name="terms" required maxLength={4000} placeholder="明确软件依赖、算法使用范围、期限、交付物与支持费用。" /></label>
            <div className="sm:col-span-2"><Button type="submit" disabled={Boolean(busy) || !selectedRequest}>{busy === "quote" ? "正在创建…" : "创建报价订单"}</Button></div>
          </form>
        </section> : <p className="rounded-lg border p-4 text-sm text-muted-foreground">你当前没有财务操作权限。报价、确认收款与交付需由已分配财务权限的人员处理。</p>}
        <section className="space-y-3" aria-label="人工交易订单"><h2 className="font-semibold">订单与交付记录</h2>
          {!workspace.orders.length && !loading && <p className="rounded-lg border p-4 text-sm text-muted-foreground">暂无订单。客户申请经确认后创建人工报价。</p>}
          {workspace.orders.map((order) => <article key={order.id} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap justify-between gap-2"><strong>订单 #{order.id} · {customerName(order.customerId)}</strong><span className="text-sm">{STATUS[order.status] || order.status}</span></div>
            <p className="text-sm">{order.productId} · 版本 #{order.versionId} · {order.currency} {(order.amountMinor / 100).toFixed(2)} · {order.deviceLimit} 台电脑</p>
            <p className="text-sm text-muted-foreground">截止时间：{order.expiresAt ? new Date(order.expiresAt).toLocaleString("zh-CN") : "按报价条款"}</p>
            {order.receiptReference && <p className="break-words text-sm">收款凭据：{order.receiptReference}</p>}
            {order.deliveryReference && <p className="break-words text-sm">交付记录：{order.deliveryReference}</p>}
            {order.status === "delivered" && <p className="text-sm text-muted-foreground">已登记人工交付；不代表客户已安装、已启用或业务效果验收通过。</p>}
            {workspace.capabilities.finance && ["quoted", "payment_confirmed"].includes(order.status) && <div className="space-y-2">
              <label className="grid gap-1 text-sm">{order.status === "quoted" ? "实际收款凭据编号" : "实际交付位置与说明"}<Input value={references[order.id] || ""} maxLength={1000} onChange={(event) => setReferences((previous) => ({ ...previous, [order.id]: event.target.value }))} /></label>
              <div className="flex flex-wrap gap-2"><Button disabled={Boolean(busy) || !references[order.id]?.trim()} onClick={() => void act(`order-${order.id}`, async () => {
                const result = await api(`/admin/orders/${order.id}/${order.status === "quoted" ? "payment" : "delivery"}`, order.status === "quoted" ? { receiptReference: references[order.id].trim() } : { deliveryReference: references[order.id].trim() });
                setReferences((previous) => ({ ...previous, [order.id]: "" }));
                return result;
              }, order.status === "quoted" ? "已登记实际收款，下一步核对交付内容。" : "已登记交付与使用权；请继续核对客户安装及有效运行。")}>{order.status === "quoted" ? "确认收到款项" : "登记实际交付"}</Button>
                {order.status === "quoted" && <Button variant="outline" disabled={Boolean(busy) || !references[order.id]?.trim()} onClick={() => void act(`cancel-${order.id}`, () => api(`/admin/orders/${order.id}/cancel`, { note: references[order.id].trim() }), "未收款订单已取消，记录保留。")}>按填写说明取消报价</Button>}</div>
            </div>}
          </article>)}
        </section>
      </TabsContent>
    </Tabs>
  </main>;
}
