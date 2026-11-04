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
const artifacts = await mkdtemp(path.join(tmpdir(), "key-usage-time-"));
const errors = [], unexpected = [], requests = [];
const occurredAt = "2026-11-03T02:57:18Z";
const stats = { observedCustomers: 1, usedCustomers: 1, errorCustomers: 1, installations: 1,
  observedEvents: 2, errors: 2, uses: 1, successes: 1, failures: 0,
  monitoringMs: 60000, monitoringSamples: 1, collectionMs: 0, collectionSamples: 0 };
const event = { schemaVersion: 1, eventId: "error-fixture", installationId: "installation-fixture",
  sessionId: "session-fixture", occurredAt, appVersion: "fixture.1", environment: "production",
  eventName: "error_reported", properties: { message: "SYNTHETIC_ERROR", module: "export", count: 2, stack: "SYNTHETIC_STACK" } };
let browser, page;

function reply(procedure, input) {
  requests.push({ procedure, input });
  if (procedure === "auth.me") return { id: 991, name: "Synthetic admin", role: "super_admin", isActive: true };
  if (procedure === "keyGenerationRequests.notifications") return { pending: 0, approved: 0 };
  if (procedure === "keys.tamperedCount") return 0;
  if (procedure === "usage.customers") return [];
  if (procedure === "usage.summary") return stats;
  if (procedure === "usage.dashboard") return { days: [{ day: Date.parse("2026-11-03") / 86400000,
    usedCustomers: 1, monitoringMs: 60000, errors: 2 }], features: [], customers: [] };
  if (procedure === "usage.events") return { items: [{ sourceId: 1, installationId: event.installationId,
    eventId: event.eventId, customerName: "Synthetic company", receivedAt: new Date("2026-11-03T03:00:00Z"), event }], total: 1, page: 1, pageSize: 50 };
  if (procedure === "usage.context") return [{ ...event, eventId: "context-fixture", eventName: "feature_attempted",
    occurredAt: "2026-11-02T16:05:00Z", properties: { featureId: "export", action: "save" } }];
  if (procedure === "uploadRetention.policy") return { enabled: false };
  if (procedure === "uploadRetention.audit") return [{ id: 1, createdAt: new Date("2026-11-03T03:10:00Z"), actorId: 991,
    kind: "usage", affected: 1, action: "synthetic-audit" }];
  unexpected.push(procedure); return {};
}

const server = await createServer({ configFile: false, root: path.join(root, "client"),
  cacheDir: path.join(artifacts, ".vite"), logLevel: "error", plugins: [react(), tailwindcss(), {
    name: "usage-time-fixture", configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/src/") || req.url?.startsWith("/@") || req.url?.includes("node_modules")) return next();
        if (!req.headers.accept?.includes("text/html")) return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await vite.transformIndexHtml(req.url || "/", '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'));
      });
    },
  }], resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared"), "@assets": path.join(root, "attached_assets") } },
  optimizeDeps: { entries: ["src/main.tsx"] }, server: { host: "127.0.0.1", port: 0, open: false },
});

try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.SHROOM_TEST_BROWSER || "chrome", headless: true });
  for (const timezoneId of ["UTC", "America/Los_Angeles"]) {
    const context = await browser.newContext({ timezoneId, viewport: { width: 1440, height: 1100 } });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    // Beijing is already November 3 while both tested browser zones are still November 2.
    await page.clock.setFixedTime(new Date("2026-11-02T16:30:00Z"));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/trpc/")) return route.continue();
      assert.equal(request.method(), "GET", "No mutation is allowed in this fixture");
      const names = decodeURIComponent(url.pathname.slice("/api/trpc/".length)).split(",");
      const inputs = JSON.parse(url.searchParams.get("input") || "{}");
      const results = names.map((name, index) => ({ result: { data: superjson.serialize(reply(name,
        superjson.deserialize(inputs[index] || { json: null }))) } }));
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(url.searchParams.has("batch") ? results : results[0]) });
    });
    await page.goto(`${origin}/usage-analytics`);
    const app = page.locator(".usage-analytics");
    await app.getByRole("heading", { name: "使用趋势", exact: true }).waitFor();
    const initial = requests.filter(r => r.procedure === "usage.dashboard").at(-1).input;
    assert.equal(initial.from, "2026-10-05"); assert.equal(initial.to, "2026-11-03");
    await app.getByText("每日数值 · 北京时间", { exact: true }).click();
    const day = app.getByRole("row").filter({ has: page.getByRole("cell", { name: "2026-11-03", exact: true }) });
    assert.equal(await day.count(), 1);
    assert.deepEqual(await day.getByRole("cell").allTextContents(), ["2026-11-03", "1", "1.0 分钟", "2"]);
    await app.getByLabel("时间范围", { exact: true }).selectOption("custom");
    await app.getByLabel("开始日期（北京时间）", { exact: true }).fill("2026-11-03");
    await app.getByLabel("结束日期（北京时间）", { exact: true }).fill("2026-11-03");
    await app.getByRole("button", { name: "查询", exact: true }).click();
    await app.getByText("2026-11-03 至 2026-11-03 · 北京时间（UTC+8） · 客户", { exact: true }).waitFor();
    await app.getByRole("tab", { name: "异常排查", exact: true }).click();
    await app.getByText("2026/11/3 10:57:18 北京时间", { exact: true }).waitFor();
    assert.equal(await app.locator("time").first().getAttribute("datetime"), occurredAt);
    const query = requests.filter(r => r.procedure === "usage.events").at(-1).input;
    assert.equal(query.filters.from, "2026-11-03"); assert.equal(query.filters.to, "2026-11-03");
    assert.equal(query.errorsOnly, true);
    await app.getByText("技术详情与调用栈", { exact: true }).click();
    await app.getByText(/接收：2026\/11\/3 11:00:00 北京时间/).waitFor();
    await app.getByRole("button", { name: "查看本次会话上下文", exact: true }).click();
    await app.getByText("2026/11/3 00:05:00 北京时间", { exact: true }).waitFor();
    await app.getByText("上传数据保存与删除", { exact: true }).click();
    await app.getByText(/2026\/11\/3 11:10:00 北京时间/).waitFor();
    await app.getByText("上传数据保存与删除", { exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert(dimensions.width <= dimensions.viewport + 1, JSON.stringify(dimensions));
      await page.screenshot({ path: path.join(artifacts, `${timezoneId.replaceAll("/", "-")}-${width}.png`), fullPage: true });
    }
    await context.close(); page = undefined;
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ passed: true, artifacts, checks: "Beijing defaults, daily labels, date filters, event/receive/context/audit times; UTC and Los Angeles; desktop/mobile; synthetic read-only APIs" }));
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true });
  console.error({ artifacts, errors, unexpected, recentRequests: requests.slice(-5) });
  throw error;
} finally { await browser?.close(); await server.close(); }
