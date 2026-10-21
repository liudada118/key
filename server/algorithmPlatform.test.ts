import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerAlgorithmPlatform } from "./algorithmPlatform";

import { createAlgorithmPlatformFixture as fixture } from "./testing/algorithmPlatformFixture";

const seller = { id: 1, role: "user" }, reviewer = { id: 2, role: "super_admin" };
/** 完整但无可执行源码的商品声明。 */
function product(version = "1.0.0") {
  return { id: "pressure-action", name: "压力动作识别", summary: "识别约定动作", task: "分析历史动作",
    deliveryType: "local", seller: { name: "受邀团队", kind: "invited" }, version, packageId: "user-pressure-action",
    compatibility: { matrixTotals: [1024], sensorTypes: ["hand"] }, inputs: "32×32映射后数值", outputs: "类别与未知状态",
    evidence: "独立记录验证，样本范围见交付说明", limitations: "未验证其他设备", support: "人工联系提交人", pricing: { mode: "manual_quote" } };
}
/** 先提交再由独立审核人发布，测试不能绕开商品准入步骤。 */
async function published(f: ReturnType<typeof fixture>, version = "1.0.0") {
  const result = await f.service.submit(seller, { product: product(version) });
  await f.service.review(reviewer, result.submission.id, { decision: "publish", note: "已核对声明、适用范围与人工交付条件" });
  return result.submission.id;
}

describe("算法平台商品与人工交易", () => {
  it("公开目录只列已审查声明，版本不可覆盖，提交人不能自审", async () => {
    const f = fixture(), submitted = await f.service.submit(seller, { product: product() });
    expect(await f.service.catalog()).toMatchObject({ products: [] });
    await expect(f.service.review({ id: 1, role: "super_admin" }, submitted.submission.id, { decision: "publish", note: "自己批准" }))
      .rejects.toMatchObject({ code: "SELF_REVIEW_FORBIDDEN" });
    await expect(f.service.review({ ...reviewer, bearer: true }, submitted.submission.id, { decision: "publish", note: "令牌提升" }))
      .rejects.toMatchObject({ code: "REVIEWER_REQUIRED" });
    expect((await f.service.submit(seller, { product: product() })).submission.id).toBe(submitted.submission.id);
    await expect(f.service.submit(seller, { product: { ...product(), inputs: "改过的输入" } })).rejects.toMatchObject({ code: "VERSION_IMMUTABLE" });
    await expect(f.service.submit({ id: 5, role: "user" }, { product: product("1.1.0") })).rejects.toMatchObject({ code: "PRODUCT_ID_OWNED" });
    await f.service.review(reviewer, submitted.submission.id, { decision: "publish", note: "完整审核记录" });
    const result = await f.service.catalog();
    expect(result).toMatchObject({ products: [{ id: "pressure-action", status: "published" }] });
    expect(JSON.stringify(result)).not.toMatch(/submittedById|contentHash|reviewNote|productJson|algorithmSource/);
    await expect(f.service.submit(seller, { product: { ...product("1.2.0"), algorithmSource: "private code" } })).rejects.toThrow();
    expect(f.state().events.map(row => row.action)).toEqual(["submitted", "published"]);
  });

  it("发布新版不修改旧版本，旧订单始终指向购买时版本", async () => {
    const f = fixture(), first = await published(f);
    const second = await published(f, "2.0.0");
    expect((await f.service.catalog()).products?.[0].version).toBe("2.0.0");
    const request = await f.service.request(42, { productId: "pressure-action", versionId: first, kind: "quote", goal: "采购原版本", idempotencyKey: "request-old" });
    const order = await f.service.quote(reviewer, { requestId: request.request.id, amountMinor: 10001, currency: "CNY", deviceLimit: 2, expiresAt: null, terms: "固定1.0.0，人工交付" });
    expect(f.state().orders.find(row => row.id === order.id).versionId).toBe(first);
    expect(second).not.toBe(first);
  });

  it("试用申请幂等且不开始计时、不记录付费成功或运行结果", async () => {
    const f = fixture(), versionId = await published(f);
    const input = { productId: "pressure-action", versionId, kind: "trial", goal: "在本机验证两组动作", idempotencyKey: "trial-42" };
    const one = await f.service.request(42, input), two = await f.service.request(42, input);
    expect(two.request.id).toBe(one.request.id);
    await expect(f.service.request(42, { ...input, goal: "不同目标" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(f.state().requests).toHaveLength(1);
    expect(f.state().orders).toHaveLength(0);
    expect(await f.service.entitlements(42)).toMatchObject({ items: [] });
    expect(one.notice).toContain("未开始计时");
  });

  it("财务职责显式分配，付款与实际交付分开，客户摘要不含账务凭据", async () => {
    const f = fixture(), versionId = await published(f);
    const request = await f.service.request(42, { productId: "pressure-action", versionId, kind: "quote", goal: "两台电脑人工交付", idempotencyKey: "order-42" });
    const quote = { requestId: request.request.id, amountMinor: 10099, currency: "CNY", deviceLimit: 2, expiresAt: "2027-01-01T00:00:00Z", terms: "指定版本与人工支持，未含宿主续期" };
    await expect(f.service.quote({ id: 3, role: "super_admin" }, quote)).rejects.toMatchObject({ code: "FINANCE_REQUIRED" });
    await expect(f.service.quote({ ...reviewer, bearer: true }, quote)).rejects.toMatchObject({ code: "FINANCE_REQUIRED" });
    await expect(f.service.quote(reviewer, { ...quote, amountMinor: 1.25 })).rejects.toThrow();
    const order = await f.service.quote(reviewer, quote);
    await expect(f.service.orderAction(reviewer, order.id, "delivery", { deliveryReference: "交付说明" })).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
    await f.service.orderAction(reviewer, order.id, "payment", { receiptReference: "人工对账凭据-001" });
    expect(await f.service.entitlements(42)).toMatchObject({ items: [{ status: "awaiting_delivery", deviceLimit: 2 }] });
    await expect(f.service.orderAction(reviewer, order.id, "payment", { receiptReference: "重复确认" })).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
    await expect(f.service.orderAction(reviewer, order.id, "cancel", { note: "直接取消已付款" })).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
    await f.service.orderAction(reviewer, order.id, "delivery", { deliveryReference: "客户已取得指定版本及使用说明，等待本机安装核验" });
    const received = await f.service.entitlements(42);
    expect(received).toMatchObject({ items: [{ status: "delivered", product: { version: "1.0.0" } }] });
    expect(JSON.stringify(received)).not.toMatch(/amountMinor|receiptReference|paidById|createdById|人工对账凭据/);
    expect(await f.service.entitlements(99)).toMatchObject({ items: [] });
    expect(received.notice).toContain("不是可执行许可");
  });

  it("并发重试只产生一份申请/报价/收款事件，另一提交人不能抢占商品身份", async () => {
    const f = fixture();
    const attempts = await Promise.allSettled([
      f.service.submit(seller, { product: product() }),
      f.service.submit({ id: 5, role: "user" }, { product: product("2.0.0") }),
    ]);
    expect(attempts.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.state().versions).toHaveLength(1);
    const versionId = f.state().versions[0].id;
    await f.service.review(reviewer, versionId, { decision: "publish", note: "核对范围" });
    const input = { productId: "pressure-action", versionId, kind: "quote", goal: "并发测试", idempotencyKey: "parallel" };
    const requested = await Promise.all([f.service.request(42, input), f.service.request(42, input)]);
    expect(requested[0].request.id).toBe(requested[1].request.id);
    const quote = { requestId: requested[0].request.id, amountMinor: 100, currency: "CNY", deviceLimit: 1, expiresAt: null, terms: "人工交付" };
    const orders = await Promise.allSettled([f.service.quote(reviewer, quote), f.service.quote(reviewer, quote)]);
    expect(orders.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    const orderId = f.state().orders[0].id;
    const paid = await Promise.allSettled([f.service.orderAction(reviewer, orderId, "payment", { receiptReference: "对账1" }),
      f.service.orderAction(reviewer, orderId, "payment", { receiptReference: "对账1" })]);
    expect(paid.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.state().events.filter(row => row.action === "payment_confirmed")).toHaveLength(1);
  });

  it("授权到期只显示已过期摘要，拒绝继续登记收款或交付", async () => {
    const f = fixture(), versionId = await published(f);
    const request = await f.service.request(42, { productId: "pressure-action", versionId, kind: "quote", goal: "期限校验", idempotencyKey: "expiry" });
    const order = await f.service.quote(reviewer, { requestId: request.request.id, amountMinor: 500, currency: "CNY", deviceLimit: 1,
      expiresAt: "2026-10-22T00:00:00Z", terms: "限定期限" });
    await f.service.orderAction(reviewer, order.id, "payment", { receiptReference: "人工确认" });
    f.state().orders[0].expiresAt = new Date("2026-10-20T00:00:00Z");
    await expect(f.service.orderAction(reviewer, order.id, "delivery", { deliveryReference: "期限已过" })).rejects.toMatchObject({ code: "ORDER_EXPIRED" });
    expect(await f.service.entitlements(42)).toMatchObject({ items: [{ status: "expired", deliveryReference: null }] });
    expect(f.state().events.some(row => row.action === "delivered")).toBe(false);
  });
});

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

/** 为真实HTTP路由注入已验证身份，不接本机真实密钥或数据库。 */
async function httpFixture() {
  const f = fixture(), app = express();
  registerAlgorithmPlatform(app, { service: f.service,
    authenticateStaff: async request => {
      const actor = request.get("x-test-actor");
      if (!actor) throw Object.assign(new Error("请登录"), { code: "STAFF_REQUIRED", httpStatus: 403 });
      return actor === "seller" ? seller : actor === "token" ? { ...reviewer, bearer: true } : reviewer;
    },
    authenticateCustomer: async request => {
      if (request.body.licenseKey !== "synthetic-software-key") throw Object.assign(new Error("无效密钥"), { code: "LICENSE_INVALID", httpStatus: 403 });
      return 42;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  disposers.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing test port");
  return { ...f, base: `http://127.0.0.1:${address.port}/api/algorithm-platform` };
}

describe("算法平台实际HTTP身份边界", () => {
  it("数据库驱动被Drizzle包装后仍返回迁移提示或竞争冲突，不泄露SQL", async () => {
    const f = await httpFixture();
    for (const [code, status, expected] of [["ER_NO_SUCH_TABLE", 503, "PLATFORM_MIGRATION_REQUIRED"], ["ER_LOCK_DEADLOCK", 409, "PLATFORM_WRITE_CONFLICT"]] as const) {
      f.service.catalog = async () => { throw Object.assign(new Error("private SQL and server path"), { cause: { code } }); };
      const response = await fetch(f.base + "/catalog");
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error).toBe(expected);
      expect(JSON.stringify(body)).not.toContain("private SQL");
    }
  });
  it("损坏JSON和超大内容始终返回明确JSON错误", async () => {
    const f = await httpFixture();
    const malformed = await fetch(f.base + "/requests", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "INPUT_INVALID" });
    const large = await fetch(f.base + "/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(50000) }) });
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ error: "INPUT_TOO_LARGE" });
  });
  it("软件Key只能取得本人回执/使用权，不能指定客户或借令牌进入后台", async () => {
    const f = await httpFixture(), versionId = await published(f);
    const post = (route: string, body: unknown, actor?: string) => fetch(f.base + route, { method: "POST",
      headers: { "content-type": "application/json", ...(actor ? { "x-test-actor": actor } : {}) }, body: JSON.stringify(body) });
    expect((await post("/entitlements", { licenseKey: "wrong" })).status).toBe(403);
    expect((await post("/entitlements", { licenseKey: "synthetic-software-key", customerId: 99 })).status).toBe(400);
    const created = await post("/requests", { licenseKey: "synthetic-software-key", productId: "pressure-action", versionId,
      kind: "quote", goal: "一个真实问题", idempotencyKey: "http-request" });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ request: { id: 1, status: "requested" } });
    expect(f.state().requests[0].customerId).toBe(42);
    expect(JSON.stringify(f.state())).not.toContain("synthetic-software-key");
    expect((await fetch(f.base + "/admin/workspace", { headers: { "x-test-actor": "token" } })).status).toBe(403);
    expect((await fetch(f.base + "/admin/workspace")).status).toBe(403);
    expect((await post(`/admin/submissions/${versionId}/review`, { decision: "publish", note: "bad" }, "token")).status).toBe(403);
    const own = await fetch(f.base + "/submissions", { headers: { "x-test-actor": "seller" } });
    expect((await own.json()).items).toHaveLength(1);
  });
});
