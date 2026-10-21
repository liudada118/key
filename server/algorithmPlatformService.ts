import { createHash } from "node:crypto";
import { z } from "zod";
import type { AlgorithmPlatformRepository, AlgorithmPlatformStore, ProductVersion } from "./algorithmPlatformStore";

/** 构造去除首尾空格的必填公开文本。 */
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
export const algorithmProductSchema = z.object({
  id, name: text(160), summary: text(500), task: text(1000),
  deliveryType: z.enum(["local", "cloud", "custom"]),
  seller: z.object({ name: text(120), kind: z.enum(["self", "invited"]) }).strict(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/).max(48),
  packageId: id.nullable().default(null),
  compatibility: z.object({ matrixTotals: z.array(z.number().int().min(1).max(65536)).max(64),
    sensorTypes: z.array(id).max(64) }).strict(),
  inputs: text(4000), outputs: text(4000), evidence: text(4000), limitations: text(4000), support: text(2000),
  pricing: z.object({ mode: z.literal("manual_quote") }).strict(),
}).strict();
export type AlgorithmProduct = z.infer<typeof algorithmProductSchema>;
export type PlatformActor = { id: number; role: string; bearer?: boolean };

/** 返回可展示且稳定的业务错误，不暴露数据库语句或原始凭据。 */
export function algorithmPlatformError(code: string, message: string, httpStatus = 400) {
  return Object.assign(new Error(message), { code, httpStatus });
}
/** 摘要仅覆盖经过白名单解析的业务数据，不保存软件密钥。 */
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
/** 输出公开商品声明，永不返回私有执行包或数据库行。 */
function publicProduct(row: ProductVersion) {
  return { ...algorithmProductSchema.parse(JSON.parse(row.productJson)), versionId: row.id, status: row.status };
}
/** 独立审核只允许登录超管，员工提交令牌不能提升为审核或财务身份。 */
function requireReviewer(actor: PlatformActor) {
  if (actor.bearer || actor.role !== "super_admin") throw algorithmPlatformError("REVIEWER_REQUIRED", "仅登录的超级管理员可以审核。", 403);
}
/** 财务职责须显式分配，原有超管不会自动取得算法订单收款权限。 */
export function algorithmFinanceAllowed(actor: PlatformActor, assigned: ReadonlySet<number>) {
  return !actor.bearer && actor.role === "super_admin" && assigned.has(actor.id);
}
/** 已知商品版本才可进入商业流程，旧订单保留原版本。 */
async function publishedVersion(repository: AlgorithmPlatformRepository, versionId: number, productId?: string) {
  const row = await repository.version(versionId);
  if (!row || row.status !== "published" || productId && row.productId !== productId) throw algorithmPlatformError("PRODUCT_UNAVAILABLE", "该算法版本尚未发布，请刷新目录。", 409);
  return row;
}

/** 构造人工交易闭环；付款、交付和算法执行状态始终分开。 */
export function createAlgorithmPlatformService(store: AlgorithmPlatformStore, { financeUsers = new Set<number>(), now = () => new Date() } = {}) {
  /** 对每个财务动作复核当前操作者分工。 */
  function finance(actor: PlatformActor) {
    if (!algorithmFinanceAllowed(actor, financeUsers)) throw algorithmPlatformError("FINANCE_REQUIRED", "请由已分配算法财务职责的超级管理员操作。", 403);
  }
  return {
    /** 返回每个商品最近发布的声明，未审核版本始终不可公开。 */
    async catalog(productId?: string) {
      return store.read(async repository => {
        const rows = (await repository.versions()).filter(row => row.status === "published");
        const seen = new Set<string>();
        const products = rows.filter(row => !seen.has(row.productId) && Boolean(seen.add(row.productId))).map(publicProduct);
        if (productId) {
          const product = products.find(item => item.id === productId);
          if (!product) throw algorithmPlatformError("PRODUCT_NOT_FOUND", "该商品尚未发布或不存在。", 404);
          return { product };
        }
        return { schemaVersion: 1, products };
      });
    },
    /** 锁定商品归属后追加不可覆盖的版本；相同内容重试复用原记录。 */
    async submit(actor: PlatformActor, input: unknown) {
      const { product } = z.object({ product: algorithmProductSchema }).strict().parse(input);
      return store.transaction(async repository => {
        if (await repository.claimProduct(product.id, actor.id) !== actor.id) throw algorithmPlatformError("PRODUCT_ID_OWNED", "商品ID已属于其他提交人，请使用新ID。", 409);
        const existing = await repository.versionsForProduct(product.id);
        if (existing.some(row => row.submittedById !== actor.id)) throw algorithmPlatformError("PRODUCT_ID_OWNED", "商品ID已属于其他提交人，请使用新ID。", 409);
        const hash = digest(product), same = existing.find(row => row.version === product.version);
        if (same) {
          if (same.contentHash !== hash) throw algorithmPlatformError("VERSION_IMMUTABLE", "该版本已提交，不能覆盖；请增加版本号。", 409);
          return { submission: { id: same.id, status: same.status, product: publicProduct(same) } };
        }
        const newId = await repository.insertVersion({ productId: product.id, version: product.version,
          productJson: JSON.stringify(product), contentHash: hash, submittedById: actor.id, status: "pending" });
        await repository.audit({ entity: "version", entityId: newId, actorId: actor.id, action: "submitted", detailsJson: JSON.stringify({ contentHash: hash }) });
        return { submission: { id: newId, status: "pending", product: { ...product, versionId: newId, status: "pending" } } };
      });
    },
    /** 提交令牌只能查询本人记录，登录超管可查询待审资料。 */
    async submissions(actor: PlatformActor) {
      return store.read(async repository => ({ items: (await repository.versions())
        .filter(row => !actor.bearer && actor.role === "super_admin" || row.submittedById === actor.id)
        .map(row => ({ id: row.id, status: row.status, submittedById: row.submittedById, reviewNote: row.reviewNote, product: publicProduct(row) })) }));
    },
    /** 独立审核人只能处理一次待审版本，并记录审核依据。 */
    async review(actor: PlatformActor, versionId: number, input: unknown) {
      requireReviewer(actor);
      const value = z.object({ decision: z.enum(["publish", "reject"]), note: text(1000) }).strict().parse(input);
      return store.transaction(async repository => {
        const row = await repository.version(versionId);
        if (!row) throw algorithmPlatformError("SUBMISSION_NOT_FOUND", "提交记录不存在。", 404);
        if (row.submittedById === actor.id) throw algorithmPlatformError("SELF_REVIEW_FORBIDDEN", "提交人不能审核自己的版本，请交由另一位超级管理员复核。", 403);
        if (row.status !== "pending") throw algorithmPlatformError("REVIEW_ALREADY_COMPLETED", "该版本已处理，请刷新记录。", 409);
        const status = value.decision === "publish" ? "published" : "rejected";
        await repository.updateVersion(row.id, { status, reviewedById: actor.id, reviewNote: value.note, reviewedAt: now() });
        await repository.audit({ entity: "version", entityId: row.id, actorId: actor.id, action: status, detailsJson: JSON.stringify({ note: value.note }) });
        return { id: row.id, status };
      });
    },
    /** 以客户和幂等编号登记需求；试用申请不代表授权或开始计时。 */
    async request(customerId: number, input: unknown) {
      const value = z.object({ idempotencyKey: id, productId: id, versionId: z.number().int().positive(),
        kind: z.enum(["quote", "trial", "custom"]), goal: text(2000) }).strict().parse(input);
      return store.transaction(async repository => {
        const hash = digest(value), existing = await repository.requestByKey(customerId, value.idempotencyKey);
        if (existing) {
          if (existing.contentHash !== hash) throw algorithmPlatformError("IDEMPOTENCY_CONFLICT", "同一请求编号的内容已变化，请重新提交。", 409);
          return { request: { id: existing.id, status: existing.status } };
        }
        await publishedVersion(repository, value.versionId, value.productId);
        const newId = await repository.insertRequest({ ...value, customerId, contentHash: hash, status: "requested" });
        await repository.audit({ entity: "request", entityId: newId, customerId, action: "requested", detailsJson: JSON.stringify({ kind: value.kind, versionId: value.versionId }) });
        return { request: { id: newId, status: "requested" }, notice: value.kind === "trial" ? "试用申请已登记；未开始计时、未扣除次数，也未授予运行许可。" : "申请已登记，等待人工确认范围和报价。" };
      });
    },
    /** 按审核、财务职责分别裁剪工作台资料。 */
    async workspace(actor: PlatformActor) {
      return store.read(async repository => {
        const review = !actor.bearer && actor.role === "super_admin", financial = algorithmFinanceAllowed(actor, financeUsers);
        return { submissions: (await repository.versions()).filter(row => review || row.submittedById === actor.id)
          .map(row => ({ id: row.id, product: publicProduct(row), status: row.status, submittedById: row.submittedById, reviewNote: row.reviewNote })),
          requests: review ? await repository.requests() : [], orders: financial ? await repository.orders() : [],
          customers: review ? await repository.customers() : [], capabilities: { review, finance: financial } };
      });
    },
    /** 报价前可受理或取消需求；已进入订单的申请不能被覆盖。 */
    async requestStatus(actor: PlatformActor, requestId: number, input: unknown) {
      requireReviewer(actor);
      const value = z.object({ status: z.enum(["reviewing", "cancelled"]), note: text(1000) }).strict().parse(input);
      return store.transaction(async repository => {
        const row = await repository.request(requestId);
        if (!row || !["requested", "reviewing"].includes(row.status)) throw algorithmPlatformError("REQUEST_STATE_CONFLICT", "申请不存在或已进入订单，请刷新。", 409);
        await repository.updateRequest(row.id, value);
        await repository.audit({ entity: "request", entityId: row.id, actorId: actor.id, action: value.status, detailsJson: JSON.stringify({ note: value.note }) });
        return { id: row.id, status: value.status };
      });
    },
    /** 为需求冻结版本、最小单位金额和人工交付条件。 */
    async quote(actor: PlatformActor, input: unknown) {
      finance(actor);
      const value = z.object({ requestId: z.number().int().positive(), amountMinor: z.number().int().min(0).max(1e12),
        currency: z.string().regex(/^[A-Z]{3}$/), deviceLimit: z.number().int().min(1).max(100000),
        expiresAt: z.string().datetime().nullable(), terms: text(4000) }).strict().parse(input);
      if (value.expiresAt && new Date(value.expiresAt) <= now()) throw algorithmPlatformError("ORDER_EXPIRY_INVALID", "授权结束时间必须晚于当前时间。");
      return store.transaction(async repository => {
        const request = await repository.request(value.requestId);
        if (!request || !["requested", "reviewing"].includes(request.status)) throw algorithmPlatformError("REQUEST_STATE_CONFLICT", "申请不存在或已报价，请刷新。", 409);
        if (await repository.orderForRequest(request.id)) throw algorithmPlatformError("ORDER_ALREADY_EXISTS", "该申请已有订单。", 409);
        await publishedVersion(repository, request.versionId, request.productId);
        const newId = await repository.insertOrder({ ...value, customerId: request.customerId, productId: request.productId,
          versionId: request.versionId, expiresAt: value.expiresAt ? new Date(value.expiresAt) : null, createdById: actor.id, status: "quoted" });
        await repository.updateRequest(request.id, { status: "quoted" });
        await repository.audit({ entity: "order", entityId: newId, actorId: actor.id, action: "quoted", detailsJson: JSON.stringify(value) });
        return { id: newId, status: "quoted" };
      });
    },
    /** 按报价→收款→交付单向转换，重复和越序动作明确失败。 */
    async orderAction(actor: PlatformActor, orderId: number, action: "payment" | "delivery" | "cancel", input: unknown) {
      finance(actor);
      const field = action === "payment" ? "receiptReference" : action === "delivery" ? "deliveryReference" : "note";
      const value = z.object({ [field]: text(2000) }).strict().parse(input) as Record<string, string>;
      return store.transaction(async repository => {
        const order = await repository.order(orderId);
        if (!order) throw algorithmPlatformError("ORDER_NOT_FOUND", "订单不存在。", 404);
        const expected = action === "delivery" ? "payment_confirmed" : "quoted";
        if (order.status !== expected) throw algorithmPlatformError("ORDER_STATE_CONFLICT", "订单状态已变化，请刷新；付款后取消须另走退款核对，不能直接删除。", 409);
        if (action !== "cancel" && order.expiresAt && order.expiresAt <= now()) throw algorithmPlatformError("ORDER_EXPIRED", "订单约定的授权期限已结束，请重新确认报价。", 409);
        const status = action === "payment" ? "payment_confirmed" : action === "delivery" ? "delivered" : "cancelled";
        await repository.updateOrder(order.id, action === "payment" ? { status, receiptReference: value.receiptReference, paidById: actor.id, paidAt: now() }
          : action === "delivery" ? { status, deliveryReference: value.deliveryReference, deliveredById: actor.id, deliveredAt: now() } : { status });
        await repository.audit({ entity: "order", entityId: order.id, actorId: actor.id, action: status, detailsJson: JSON.stringify(value) });
        return { id: order.id, status };
      });
    },
    /** 返回本人使用权登记摘要，不透露财务凭据或宣称算法已运行。 */
    async entitlements(customerId: number) {
      return store.read(async repository => {
        const items = [];
        for (const order of (await repository.orders(customerId)).filter(row => ["payment_confirmed", "delivered"].includes(row.status))) {
          const version = await repository.version(order.versionId);
          if (!version) continue;
          items.push({ id: order.id, productId: order.productId, versionId: order.versionId, product: publicProduct(version),
            status: order.expiresAt && order.expiresAt <= now() ? "expired" : order.status === "delivered" ? "delivered" : "awaiting_delivery",
            deviceLimit: order.deviceLimit, expiresAt: order.expiresAt?.toISOString() ?? null,
            deliveryReference: order.status === "delivered" ? order.deliveryReference : null });
        }
        return { items, notice: "人工交付登记不代表已安装、已启用或完成设备效果验证；该摘要不是可执行许可。" };
      });
    },
  };
}
