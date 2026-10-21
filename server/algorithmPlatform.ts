import express, { type Express, type Request } from "express";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { customers, licenseKeys, offlineKeys, rsaKeyPairs, systemPackageSubmitTokens, users } from "../drizzle/schema";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { verifyOfflineClientKey, verifyOnlineClientKey } from "./systemPackageClientLicense";
import { createSqlAlgorithmPlatformStore } from "./algorithmPlatformStore";
import { algorithmPlatformError, createAlgorithmPlatformService, type PlatformActor } from "./algorithmPlatformService";

type Service = ReturnType<typeof createAlgorithmPlatformService>;
type Options = { service?: Service; authenticateStaff?: (request: Request) => Promise<PlatformActor>;
  authenticateCustomer?: (request: Request) => Promise<number> };

/** 浏览器会话遵守同源边界，sps令牌只得到本人提交身份。 */
async function staff(request: Request): Promise<PlatformActor> {
  const origin = request.get("origin");
  try { if (origin && new URL(origin).host !== request.get("host")) throw new Error(); }
  catch { throw algorithmPlatformError("ORIGIN_FORBIDDEN", "请从管理网站或软件内操作。", 403); }
  const authorization = request.get("authorization");
  if (authorization) {
    const token = /^Bearer (sps_[A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
    if (!token) throw algorithmPlatformError("SUBMISSION_TOKEN_INVALID", "员工提交令牌格式无效。", 403);
    const database = await getDb();
    if (!database) throw algorithmPlatformError("STORAGE_UNAVAILABLE", "授权存储暂不可用。", 503);
    const [record] = await database.select({ id: users.id, role: users.role, active: users.isActive,
      expiresAt: systemPackageSubmitTokens.expiresAt, revokedAt: systemPackageSubmitTokens.revokedAt })
      .from(systemPackageSubmitTokens).innerJoin(users, eq(users.id, systemPackageSubmitTokens.userId))
      .where(eq(systemPackageSubmitTokens.tokenHash, createHash("sha256").update(token).digest("hex"))).limit(1);
    if (!record?.active || record.revokedAt || record.expiresAt.getTime() <= Date.now()) throw algorithmPlatformError("SUBMISSION_TOKEN_INVALID", "员工提交令牌已失效。", 403);
    return { id: record.id, role: record.role, bearer: true };
  }
  const user = await sdk.authenticateRequest(request);
  if (!user?.isActive) throw algorithmPlatformError("STAFF_REQUIRED", "请先登录管理账号。", 403);
  return { id: user.id, role: user.role };
}

/** 仅由已登记的软件密钥证明稳定客户归属，不接受客户端传入的客户ID。 */
async function customer(request: Request) {
  const key = request.body?.licenseKey;
  if (typeof key !== "string" || key.length < 32 || key.length > 8192) throw algorithmPlatformError("LICENSE_INVALID", "请先激活有效的软件密钥。", 403);
  const database = await getDb();
  if (!database) throw algorithmPlatformError("STORAGE_UNAVAILABLE", "授权存储暂不可用。", 503);
  let result;
  if (/^[a-fA-F0-9]+$/.test(key)) {
    const [record] = await database.select({ productType: licenseKeys.productType, keyString: licenseKeys.keyString,
      status: licenseKeys.status, expireTimestamp: licenseKeys.expireTimestamp, customerId: licenseKeys.customerId,
      isDeleted: licenseKeys.isDeleted }).from(licenseKeys).where(eq(licenseKeys.keyString, key)).limit(1);
    result = record ? verifyOnlineClientKey(key, record) : { error: "LICENSE_INACTIVE" };
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(key)) {
    const [record] = await database.select({ productType: offlineKeys.productType, activationCode: offlineKeys.activationCode,
      status: offlineKeys.status, isDeleted: offlineKeys.isDeleted, customerId: offlineKeys.customerId,
      expireDate: offlineKeys.expireDate, publicKey: rsaKeyPairs.publicKey }).from(offlineKeys)
      .innerJoin(rsaKeyPairs, eq(rsaKeyPairs.id, offlineKeys.rsaKeyPairId)).where(eq(offlineKeys.activationCode, key)).limit(1);
    result = record ? verifyOfflineClientKey(key, record) : { error: "OFFLINE_KEY_NOT_REGISTERED" };
  }
  const customerId = result?.grant?.customerId;
  if (!Number.isSafeInteger(customerId) || !customerId) throw algorithmPlatformError(result?.error || "CUSTOMER_LINK_REQUIRED", "请管理员核对软件密钥的有效状态和客户关联。", 403);
  const [record] = await database.select({ id: customers.id, active: customers.isActive }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!record?.active) throw algorithmPlatformError("CUSTOMER_INACTIVE", "当前客户关联不可用，请联系管理员。", 403);
  return customerId;
}

/** 数字路径只定位一条业务记录，拒绝小数、符号及超出安全整数的身份。 */
function numericId(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw algorithmPlatformError("INPUT_INVALID", "记录编号无效。");
  return Number(value);
}

/** 注册人工交易API；未配置数据库或财务职责时拒绝写入，不生成演示订单。 */
export function registerAlgorithmPlatform(app: Express, options: Options = {}) {
  const configured = new Set((process.env.ALGORITHM_PLATFORM_FINANCE_USER_IDS || "").split(",")
    .filter(value => /^[1-9]\d*$/.test(value.trim())).map(value => Number(value.trim())));
  const service = options.service || createAlgorithmPlatformService(createSqlAlgorithmPlatformStore(), { financeUsers: configured });
  const authenticateStaff = options.authenticateStaff || staff, authenticateCustomer = options.authenticateCustomer || customer;
  const router = express.Router();
  router.use(express.json({ limit: "48kb", inflate: false }));
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  /** 所有异常收敛为公开错误码，不把SQL、密钥或服务端路径传给客户端。 */
  const handler = (run: (req: Request) => Promise<unknown>) => async (req: Request, res: express.Response) => {
    try { res.json(await run(req)); }
    catch (cause) {
      const error = (cause && typeof cause === "object" ? cause : {}) as { code?: string; httpStatus?: number; message?: string; cause?: { code?: string } };
      const databaseCode = error.code || error.cause?.code;
      if (cause instanceof ZodError) { res.status(400).json({ error: "INPUT_INVALID", message: "请填写完整且有效的商品或订单字段，不允许额外源码、密钥或客户身份字段。" }); return; }
      if (databaseCode === "ER_NO_SUCH_TABLE") { res.status(503).json({ error: "PLATFORM_MIGRATION_REQUIRED", message: "算法平台尚未完成数据库迁移，请联系管理员。" }); return; }
      if (databaseCode === "ER_DUP_ENTRY" || databaseCode === "ER_LOCK_DEADLOCK") { res.status(409).json({ error: "PLATFORM_WRITE_CONFLICT", message: "同一记录正在提交，请刷新或使用原请求编号重试。" }); return; }
      res.status(error.httpStatus || 503).json({ error: error.httpStatus ? error.code : "ALGORITHM_PLATFORM_UNAVAILABLE",
        message: error.httpStatus ? error.message : "算法平台服务暂不可用，请稍后重试。" });
    }
  };
  router.get("/catalog", (_req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); }, handler(() => service.catalog()));
  router.get("/products/:id", handler(req => service.catalog(req.params.id)));
  router.post("/submissions", handler(async req => service.submit(await authenticateStaff(req), req.body)));
  router.get("/submissions", handler(async req => service.submissions(await authenticateStaff(req))));
  router.post("/requests", handler(async req => {
    const customerId = await authenticateCustomer(req), { licenseKey: _key, ...value } = req.body;
    return service.request(customerId, value);
  }));
  router.post("/entitlements", handler(async req => {
    if (Object.keys(req.body || {}).some(key => key !== "licenseKey")) throw algorithmPlatformError("INPUT_INVALID", "使用权查询不能指定其他客户或订单。");
    return service.entitlements(await authenticateCustomer(req));
  }));
  router.get("/admin/workspace", handler(async req => {
    const actor = await authenticateStaff(req);
    if (actor.bearer) throw algorithmPlatformError("STAFF_SESSION_REQUIRED", "管理工作台需要网站登录，不接受员工提交令牌。", 403);
    return service.workspace(actor);
  }));
  router.post("/admin/submissions/:id/review", handler(async req => service.review(await authenticateStaff(req), numericId(req.params.id), req.body)));
  router.post("/admin/requests/:id/status", handler(async req => service.requestStatus(await authenticateStaff(req), numericId(req.params.id), req.body)));
  router.post("/admin/orders", handler(async req => service.quote(await authenticateStaff(req), req.body)));
  for (const action of ["payment", "delivery", "cancel"] as const) router.post(`/admin/orders/:id/${action}`,
    handler(async req => service.orderAction(await authenticateStaff(req), numericId(req.params.id), action, req.body)));
  router.use((error: { status?: number }, _req: Request, res: express.Response, _next: express.NextFunction) => {
    const status = error.status === 413 ? 413 : 400;
    res.status(status).json({ error: status === 413 ? "INPUT_TOO_LARGE" : "INPUT_INVALID", message: "请求内容无效或超出大小限制。" });
  });
  app.use("/api/algorithm-platform", router);
}
