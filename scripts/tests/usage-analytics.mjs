import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../package.json", import.meta.url));
const desktopRequire = createRequire(pathToFileURL(process.env.SHROOM_TEST_PACKAGE || "E:/shroom1/package.json"));
const { chromium } = desktopRequire("playwright");
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href);
const { default: tailwindcss } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href);
const { default: superjson } = await import(pathToFileURL(require.resolve("superjson")).href);
const artifacts = await mkdtemp(path.join(tmpdir(), "key-usage-ui-"));
const requests = [], errors = [], unexpected = [];
let role = "super_admin", active = true, mode = "normal";
let browser, page;
const now = Date.now();
const stats = { observedCustomers: 2, usedCustomers: 1, errorCustomers: 1, installations: 3,
  observedEvents: 21, exposures: 7, attempts: 4, uses: 3, successes: 3, failures: 1, cancelled: 0,
  unknownResults: 0, errors: 2, activeDays: 4, monitoringMs: 3600000, monitoringSamples: 2,
  collectionMs: 120000, collectionSamples: 1, lastUsedMs: now, lastObservedMs: now, lastReceivedMs: now };
const companies = [{ customerKey: "customer:1", customerName: "合成康复中心" }, { customerKey: "customer:2", customerName: "合成传感实验室" }, { customerKey: "source:3", customerName: "未绑定来源 · 示例 #3" }];
const features = [
  { ...stats, featureId: "monitoring", category: "business" },
  { ...stats, featureId: "collection", category: "business", monitoringSamples: 0, monitoringMs: 0 },
  { ...stats, featureId: "export", category: "business", monitoringSamples: 0, monitoringMs: 0 },
  { ...stats, featureId: "main_memory", category: "diagnostic", usedCustomers: 0, uses: 0, successes: 0, failures: 0 },
];

function reply(procedure, input) {
  requests.push({ procedure, input });
  if (procedure === "auth.me") return { id: 991, name: "合成验收账号", role, isActive: active };
  if (procedure === "usage.customers") return companies;
  if (procedure === "usage.summary") return mode === "empty" ? { ...stats, observedCustomers: 0, usedCustomers: 0, errors: 0, monitoringSamples: 0, monitoringMs: 0 } : stats;
  if (procedure === "usage.featureUsage") {
    let items = features.filter(item => input.category === "all" || item.category === input.category);
    if (input.filters.featureId) items = items.filter(item => item.featureId === input.filters.featureId);
    return { items: mode === "empty" ? [] : items, total: mode === "empty" ? 0 : items.length, page: 1, pageSize: 20 };
  }
  if (procedure === "usage.customerUsage") {
    const entries = input.filters.identityScope === "unbound" ? companies.slice(2) : companies.slice(0, 2);
    const items = entries.filter(c => !input.filters.customerKey || c.customerKey === input.filters.customerKey).map((c, i) => ({ ...stats, ...c, systemCount: 2, ...(i === 1 ? { lastUsedMs: null, monitoringSamples: 0, collectionSamples: 0, uses: 0, activeDays: 0 } : {}) }));
    return { items: mode === "empty" ? [] : items, total: mode === "empty" ? 0 : 21, page: input.page, pageSize: 20 };
  }
  if (procedure === "usage.systems") return [{ systemType: "jqbed", customers: 1, installations: 2, entries: 5, monitoringMs: 3600000, monitoringSamples: 2 }];
  if (procedure === "usage.events") return { items: mode === "empty" ? [] : [{ sourceId: 1,
    installationId: "249c3777-cff6-44e4-99ea-a812e302a992", eventId: "149c3777-cff6-44e4-99ea-a812e302a992",
    customerName: "合成康复中心", receivedAt: new Date(), event: { schemaVersion: 1,
      eventId: "149c3777-cff6-44e4-99ea-a812e302a992", installationId: "249c3777-cff6-44e4-99ea-a812e302a992",
      sessionId: "349c3777-cff6-44e4-99ea-a812e302a992", occurredAt: new Date().toISOString(), appVersion: "fixture.1", environment: "production",
      eventName: input.errorsOnly ? "error_reported" : "export_result", properties: { featureId: input.filters.featureId || "export", result: input.errorsOnly ? "failure" : "success", count: 2, ...(input.errorsOnly ? { message: "合成导出失败", module: "export", stack: "SYNTHETIC STACK" } : { format: "csv" }) } } }], total: 1, page: 1, pageSize: 50 };
  if (procedure === "usage.context") return [{ eventId: "context-fixture", eventName: "feature_attempted", occurredAt: new Date().toISOString(), properties: { featureId: "export", action: "save" } }];
  unexpected.push(procedure); return {};
}

const server = await createServer({ configFile: false, root: path.join(root, "client"), cacheDir: path.join(artifacts, ".vite"), logLevel: "error",
  plugins: [react(), tailwindcss(), { name: "usage-ui-fixture", configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url?.startsWith("/src/") || req.url?.startsWith("/@") || req.url?.includes("node_modules")) return next();
      if (!req.headers.accept?.includes("text/html")) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await vite.transformIndexHtml(req.url || "/", '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'));
    });
  } }], resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared"), "@assets": path.join(root, "attached_assets") } },
  optimizeDeps: { entries: ["src/main.tsx"] }, server: { host: "127.0.0.1", port: 0, open: false },
});

function last(procedure) { return requests.filter(r => r.procedure === procedure).at(-1)?.input; }
async function received(procedure, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const input = last(procedure);
    if (input && predicate(input)) return input;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Missing matching request: ${procedure}`);
}
async function noOverflow() { const d = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert(d.width <= d.viewport + 1, JSON.stringify(d)); }

try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.SHROOM_TEST_BROWSER || "chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/trpc/")) return route.continue();
    const names = decodeURIComponent(url.pathname.slice("/api/trpc/".length)).split(",");
    const inputs = JSON.parse(url.searchParams.get("input") || request.postData() || "{}");
    const results = names.map((name, index) => mode === "failure" && name === "usage.customerUsage"
      ? { error: superjson.serialize({ message: "SYNTHETIC_FAILURE", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: name } }) }
      : { result: { data: superjson.serialize(reply(name, superjson.deserialize(inputs[index] || { json: null }))) } });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.searchParams.has("batch") ? results : results[0]) });
  });
  await page.goto(`${origin}/usage-analytics`);
  const app = page.locator(".usage-analytics");
  await app.getByRole("button", { name: "合成康复中心", exact: true }).waitFor();
  assert.equal(last("usage.customerUsage").filters.identityScope, "company");
  await app.getByRole("tab", { name: "按功能看", exact: true }).click();
  await app.getByRole("button", { name: "数据采集", exact: true }).waitFor();
  assert.equal(last("usage.featureUsage").category, "business");
  await app.getByRole("button", { name: "CSV 导出", exact: true }).click();
  await app.getByRole("heading", { name: "此功能的客户使用情况", exact: true }).waitFor();
  await received("usage.customerUsage", input => input.filters.featureId === "export");
  assert.equal(await app.getByRole("columnheader", { name: "主要使用指标", exact: true }).count(), 1);
  await app.getByRole("button", { name: "合成康复中心", exact: true }).click();
  await app.locator(".usage-table").getByRole("button", { name: "CSV 导出", exact: true }).waitFor();
  await app.locator(".usage-table").getByRole("button", { name: "CSV 导出", exact: true }).click();
  await app.getByRole("button", { name: "查看本次会话上下文", exact: true }).waitFor();
  await received("usage.events", input => input.filters.featureId === "export" && input.filters.customerKey === "customer:1");
  await app.getByRole("button", { name: "查看本次会话上下文", exact: true }).click();
  await app.getByText("同安装、同会话的最近 20 条记录", { exact: true }).waitFor();
  assert.equal(last("usage.context").sourceId, 1);
  await app.getByRole("tab", { name: "异常排查", exact: true }).click();
  await app.getByText("合成导出失败", { exact: true }).waitFor();
  assert.equal(last("usage.events").errorsOnly, true);
  await app.getByText("技术详情与调用栈", { exact: true }).click();
  await app.getByText("SYNTHETIC STACK", { exact: true }).waitFor();
  const summaryRequests = requests.filter(r => r.procedure === "usage.summary").length;
  await app.getByLabel("错误模块（精确匹配）", { exact: true }).fill("export");
  await app.getByRole("button", { name: "筛选错误", exact: true }).click();
  await received("usage.events", input => input.filters.module === "export");
  assert.equal(requests.filter(r => r.procedure === "usage.summary").length, summaryRequests);
  await app.getByLabel("错误模块（精确匹配）", { exact: true }).fill("invalid module");
  await app.getByText("模块标识仅支持字母、数字和 _.:-。", { exact: true }).waitFor();
  assert.equal(last("usage.events").filters.module, "export");
  await app.getByRole("tab", { name: "展示系统", exact: true }).click();
  await app.getByRole("button", { name: "小床监测", exact: true }).click();
  await app.getByRole("button", { name: "清除系统筛选", exact: true }).waitFor();
  await received("usage.events", input => input.filters.systemType === "jqbed");
  await app.getByRole("button", { name: "全部功能", exact: true }).click();
  await app.getByRole("button", { name: "传感器监测", exact: true }).waitFor();
  await app.getByLabel("功能分类", { exact: true }).selectOption("diagnostic");
  await app.getByRole("button", { name: "主进程内存", exact: true }).waitFor();
  assert.equal(last("usage.featureUsage").category, "diagnostic");
  await app.getByLabel("功能分类", { exact: true }).selectOption("business");
  for (const width of [1440, 1024, 375]) {
    await page.setViewportSize({ width, height: 1100 });
    await app.getByRole("button", { name: "数据采集", exact: true }).waitFor(); await noOverflow();
    await page.screenshot({ path: path.join(artifacts, `features-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: path.join(artifacts, "features-dark.png"), fullPage: true }); await noOverflow();
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await app.getByRole("tab", { name: "按客户看", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await app.locator('#usage-view-features[data-state="active"]').waitFor();
  await app.getByRole("tab", { name: "按客户看", exact: true }).click();
  await app.getByRole("button", { name: "合成康复中心", exact: true }).waitFor();
  await app.getByRole("button", { name: "下一页", exact: true }).click();
  await app.getByText("共 21 项 · 第 2 / 2 页", { exact: true }).waitFor();
  assert.equal(last("usage.customerUsage").page, 2);
  await app.getByLabel("归属范围", { exact: true }).selectOption("unbound");
  await app.getByRole("button", { name: "查询", exact: true }).click();
  await app.getByRole("button", { name: "未绑定来源 · 示例 #3", exact: true }).waitFor();
  assert.equal(last("usage.customerUsage").page, 1);
  mode = "empty"; await page.reload();
  await app.getByText("此范围内尚未观测到匹配记录。", { exact: true }).waitFor();
  mode = "failure"; await page.reload();
  await app.getByText("数据加载失败，请点击刷新重试。", { exact: true }).waitFor();
  mode = "normal"; await app.getByRole("button", { name: "刷新", exact: true }).click();
  await app.getByRole("button", { name: "合成康复中心", exact: true }).waitFor();
  for (const [nextRole, isActive] of [["user", true], ["super_admin", false]]) {
    role = nextRole; active = isActive; const start = requests.length; await page.reload();
    await page.getByText("需要启用中的超级管理员账号查看客户使用情况。", { exact: true }).waitFor();
    assert(!requests.slice(start).some(r => r.procedure.startsWith("usage.")));
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ passed: true, artifacts, checks: "real UI, bidirectional drill-down, feature/customer/system event scope, session context, error-only module filters, diagnostics, pagination, unbound scope, empty/failure/retry/permission states, keyboard tabs, responsive and dark mode; synthetic APIs only" }));
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true });
  console.error({ artifacts, errors, unexpected, recentRequests: requests.slice(-5), body: await page?.locator("body").innerText() });
  throw error;
} finally { await browser?.close(); await server.close(); }
