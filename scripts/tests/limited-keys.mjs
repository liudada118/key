import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const requireKey = createRequire(new URL("../../package.json", import.meta.url));
const requireShroom = createRequire(pathToFileURL(process.env.SHROOM_TEST_PACKAGE || "E:/shroom1/package.json"));
const { chromium } = requireShroom("playwright");
const { createServer } = await import(pathToFileURL(requireKey.resolve("vite")).href);
const { default: react } = await import(pathToFileURL(requireKey.resolve("@vitejs/plugin-react")).href);
const { default: tailwindcss } = await import(pathToFileURL(requireKey.resolve("@tailwindcss/vite")).href);
const { default: superjson } = await import(pathToFileURL(requireKey.resolve("superjson")).href);
const artifacts = await mkdtemp(path.join(tmpdir(), "key-limited-ui-"));
const requests = [];
const errors = [];
const unexpected = [];
let role = "super_admin";
let browser;
let page;
const user = { id: 91, name: "合成验收账号", role: "super_admin", email: "fixture@example.invalid" };
const groups = [{ group: "精密", icon: "", items: [{ label: "手部检测", value: "hand" }] }];
const companySystem = { systemId: "company-seat-fixture", name: "公司坐垫展示" };
const limits = { online: 3, offline: 3 };

/** Produce populated lists, including a v4 offline code whose allowance was lifted. */
function records(procedure, input) {
  const offline = procedure.startsWith("offlineKeys");
  const current = limits[offline ? "offline" : "online"];
  const base = { keyString: "SYNTHETIC-NOT-A-LICENSE", activationCode: "SYNTHETIC-NOT-AN-ACTIVATION-CODE", sensorType: "hand", sensorTypes: "hand", days: 30,
    expireTimestamp: Date.now() + 86400000, expireDate: Date.now() + 86400000, createdAt: new Date(), status: "ISSUED", createdByName: "合成验收账号", customerName: "合成客户", customerId: 1 };
  const all = [{ ...base, id: 101, deviceLimit: 0, deviceRestricted: false }, { ...base, id: 102, deviceLimit: current, deviceRestricted: offline || current > 0 }];
  if (offline) all.push({ ...base, id: 103, deviceLimit: 0, deviceRestricted: true });
  const items = all.filter(item => input?.deviceMode === "limited" ? item.deviceRestricted : !item.deviceRestricted);
  return { items, total: items.length, page: input?.page || 1, pageSize: input?.pageSize || 20 };
}

/** 为真实 tRPC hook 返回合成结果，同时保留输入以核对分类和签发参数。 */
function reply(procedure, input) {
  requests.push({ procedure, input });
  switch (procedure) {
    case "auth.me": return { ...user, role };
    case "sensors.groups": return groups;
    case "sensors.licenseGroups": return { groups: [] };
    case "customers.all": return [];
    case "contracts.list": return { items: [], total: 0, page: 1, pageSize: 1000 };
    case "contracts.policy": return { requireContract: false };
    case "keys.list":
    case "offlineKeys.list": return records(procedure, input);
    case "offlineKeys.stats": return { total: 0 };
    case "keys.statusHistory": return { items: [] };
    case "keys.export": return input.format === "csv" ? "synthetic,not-a-license" : [{ id: 102, synthetic: true }];
    case "keys.devices": return { maxDevices: limits[input.keyType || "online"], devices: [] };
    case "keys.setDeviceLimit": limits[input.keyType || "online"] = input.maxDevices; return { ok: true };
    case "keys.generate": return { keyString: "SYNTHETIC-NOT-A-LICENSE", expireTimestamp: Date.now() + 86400000, deviceLimit: input.deviceLimit || 0 };
    case "keys.batchGenerate": return { batchId: "synthetic", keys: Array.from({ length: input.count }, () => ({ keyString: "SYNTHETIC-NOT-A-LICENSE" })), count: input.count };
    case "offlineKeys.generate": return { activationCode: "SYNTHETIC-NOT-AN-ACTIVATION-CODE", sensorTypes: input.sensorTypes, days: input.days, expireDate: Date.now() + 86400000, deviceLimit: input.deviceLimit || 0 };
    default: unexpected.push(procedure); return {};
  }
}

/** 只允许隔离 Vite 资源和合成 API；任何外部网络请求都会被中止。 */
async function mockRequests(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname !== "127.0.0.1") {
    if (!request.isNavigationRequest()) return route.abort();
    throw new Error(`Unexpected external navigation: ${url.origin}`);
  }
  if (url.pathname.startsWith("/api/trpc/")) {
    const procedures = decodeURIComponent(url.pathname.slice("/api/trpc/".length)).split(",");
    const inputs = request.method() === "GET" ? JSON.parse(url.searchParams.get("input") || "{}") : JSON.parse(request.postData() || "{}");
    const results = procedures.map((procedure, index) => ({ result: { data: superjson.serialize(reply(procedure, superjson.deserialize(inputs[index] || { json: null }))) } }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(url.searchParams.get("batch") ? results : results[0]) });
  }
  if (url.pathname.startsWith("/api/system-packages")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ systems: [companySystem] }) });
  if (url.pathname.startsWith("/api/")) {
    unexpected.push(url.pathname);
    return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  }
  return route.continue();
}

const server = await createServer({
  configFile: false,
  root: path.join(root, "client"),
  cacheDir: path.join(artifacts, ".vite"),
  logLevel: "error",
  plugins: [react(), tailwindcss(), {
    name: "limited-keys-fixture",
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0]?.startsWith("/src/") || req.url?.startsWith("/@") || req.url?.includes("node_modules")) return next();
        if (req.headers.accept?.includes("text/html")) {
          res.setHeader("Content-Type", "text/html");
          return res.end(await vite.transformIndexHtml(req.url || "/", '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/src/__fixtures__/limitedKeys.tsx"></script></body></html>'));
        }
        return next();
      });
    },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared"), "@assets": path.join(root, "attached_assets") } },
  optimizeDeps: { entries: ["src/__fixtures__/limitedKeys.tsx"] },
  server: { host: "127.0.0.1", port: 0, open: false },
});

/** 等待真实页面的指定 tRPC 请求；不靠固定延时判断签发完成。 */
async function waitForRequest(procedure, start = 0, predicate = () => true) {
  await page.waitForFunction(() => document.readyState === "complete");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const hit = requests.slice(start).find(item => item.procedure === procedure && predicate(item.input));
    if (hit) return hit;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`No matching ${procedure} request: ${JSON.stringify(requests.slice(start))}`);
}

/** 通过实际生成按钮提交所选合成系统，并取得送往接口的参数。 */
async function generate(procedure, systemName = "手部检测") {
  await page.getByText(systemName, { exact: true }).click();
  const start = requests.length;
  await page.locator("main").last().getByRole("button", { name: /^生成(?:限制)?密钥$|^生成离线激活码$/ }).click();
  return (await waitForRequest(procedure, start)).input;
}

/** 检查整个文档的宽度，允许表格在自身容器内滚动。 */
async function assertNoPageOverflow(label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert(dimensions.width <= dimensions.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

/** Validate both export formats without storing or reading an actual license. */
async function exportCategory(expectedMode) {
  for (const format of ["CSV", "JSON"]) {
    const start = requests.length;
    await Promise.all([page.waitForEvent("download"), page.locator("main").last().getByRole("button", { name: format, exact: true }).click()]);
    const event = await waitForRequest("keys.export", start);
    assert.equal(event.input.deviceMode, expectedMode, `${format} keeps the active category`);
  }
}

try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.SHROOM_TEST_BROWSER || "chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", mockRequests);

  await page.goto(`${origin}/generate`);
  await waitForRequest("contracts.policy");
  assert.equal(await page.locator('input[id*="device-limit"]').count(), 0, "ordinary generation cannot accidentally enable computer limits");
  const ordinary = await generate("keys.generate");
  assert.equal(ordinary.deviceLimit || 0, 0, "ordinary online keys stay unlimited");
  await page.getByText("限制密钥", { exact: true }).waitFor();
  await page.getByRole("button", { name: /生成限制密钥|限制密钥生成/, exact: true }).click();
  await page.waitForURL("**/limited-generate");
  const limit = page.getByLabel(/每把密钥最多可用电脑数|电脑数量上限/);
  await limit.waitFor();
  await page.getByText("手部检测", { exact: true }).click();
  for (const invalid of ["0", "-1", "1.5", ""]) {
    await limit.fill(invalid);
    const start = requests.length;
    const button = page.locator("main").last().getByRole("button", { name: /^生成(?:限制)?密钥$/ });
    if (await button.isEnabled()) await button.click();
    await page.waitForTimeout(100);
    assert(!requests.slice(start).some(item => item.procedure === "keys.generate"), `invalid limited online value ${JSON.stringify(invalid)} must not submit`);
  }
  await limit.fill("3");
  const limitedStart = requests.length;
  await page.locator("main").last().getByRole("button", { name: /^生成(?:限制)?密钥$/ }).click();
  assert.equal((await waitForRequest("keys.generate", limitedStart)).input.deviceLimit, 3);
  await page.getByRole("tab", { name: "批量生成", exact: true }).click();
  await page.getByText("手部检测", { exact: true }).click();
  await page.locator("#online-device-limit-batch").fill("2");
  await page.locator('input[max="500"]').fill("2");
  const batchStart = requests.length;
  await page.locator("main").last().getByRole("button", { name: "批量生成", exact: true }).click();
  const batch = (await waitForRequest("keys.batchGenerate", batchStart)).input;
  assert.equal(batch.deviceLimit, 2);
  assert.equal(batch.count, 2);
  await page.getByRole("tab", { name: "离线密钥", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("手部检测", { exact: true }).click();
  for (const invalid of ["0", "1.5", ""]) {
    await page.getByLabel(/每把密钥最多可用电脑数|电脑数量上限/).fill(invalid);
    const start = requests.length;
    await page.getByRole("button", { name: "生成离线激活码", exact: true }).click();
    await page.waitForTimeout(100);
    assert(!requests.slice(start).some(item => item.procedure === "offlineKeys.generate"), `invalid limited offline value ${JSON.stringify(invalid)} must not submit`);
  }
  await page.getByLabel(/每把密钥最多可用电脑数|电脑数量上限/).fill("4");
  const offlineStart = requests.length;
  await page.getByRole("button", { name: "生成离线激活码", exact: true }).click();
  assert.equal((await waitForRequest("offlineKeys.generate", offlineStart)).input.deviceLimit, 4);

  await page.goto(`${origin}/offline-keys`);
  assert.equal(await page.locator('input[id*="device-limit"]').count(), 0, "ordinary offline generation cannot enable computer limits");
  assert.equal((await generate("offlineKeys.generate")).deviceLimit || 0, 0);

  for (const pathname of ["/generate", "/limited-generate", "/offline-keys", "/limited-generate?type=offline"]) {
    const offline = pathname.includes("offline");
    const start = requests.length;
    await page.goto(origin + pathname);
    await page.getByText(companySystem.name, { exact: true }).waitFor();
    assert.equal(await page.locator('[id^="package-customer-"]').count(), 0, "a published system must not introduce an extra customer selector");
    assert.equal(await page.getByText("（公司系统必选）", { exact: false }).count(), 0);
    const input = await generate(offline ? "offlineKeys.generate" : "keys.generate", companySystem.name);
    assert.deepEqual([].concat(input.sensorTypes), [companySystem.systemId], "the published system is granted by the key scope");
    assert.equal(input.customerId, undefined, "company system generation does not require a linked customer");
    if (!offline) assert(!requests.slice(start).some(item => item.procedure === "customers.all"), "online generation has no customer-list dependency");
    if (pathname === "/limited-generate") {
      await page.getByRole("tab", { name: "批量生成", exact: true }).click();
      await page.getByText(companySystem.name, { exact: true }).click();
      await page.locator('input[max="500"]').fill("2");
      const batchStart = requests.length;
      await page.locator("main").last().getByRole("button", { name: "批量生成", exact: true }).click();
      const input = (await waitForRequest("keys.batchGenerate", batchStart)).input;
      assert.deepEqual([].concat(input.sensorTypes), [companySystem.systemId]);
      assert.equal(input.customerId, undefined);
      assert.equal(input.deviceLimit, 1);
    }
  }

  await page.goto(`${origin}/keys`);
  await waitForRequest("keys.list", 0, input => input?.deviceMode === "unlimited");
  await exportCategory("unlimited");
  await page.goto(`${origin}/offline-key-list`);
  await waitForRequest("offlineKeys.list", 0, input => input?.deviceMode === "unlimited");
  await page.goto(`${origin}/limited-keys`);
  await waitForRequest("keys.list", 0, input => input?.deviceMode === "limited");
  await exportCategory("limited");
  await page.getByRole("tab", { name: "离线密钥", exact: true }).click();
  await waitForRequest("offlineKeys.list", 0, input => input?.deviceMode === "limited");
  await page.getByText("不限量（新版授权）", { exact: true }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const pathname of ["/limited-generate", "/limited-keys"]) {
    await page.goto(origin + pathname);
    await page.getByRole("tab", { name: "在线密钥", exact: true }).waitFor();
    await page.getByText("手部检测", { exact: true }).first().waitFor();
    await assertNoPageOverflow(pathname + " online");
    await page.screenshot({ path: path.join(artifacts, `${pathname.slice(1)}-mobile-online.png`), fullPage: true });
    const onlineTab = page.getByRole("tab", { name: "在线密钥", exact: true });
    await onlineTab.focus();
    await page.keyboard.press("ArrowRight");
    await page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: "离线密钥" }).waitFor();
    await page.getByText("手部检测", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("tab", { name: "离线密钥", exact: true }).getAttribute("aria-selected"), "true", "tabs support keyboard navigation");
    await assertNoPageOverflow(pathname + " offline");
    await page.screenshot({ path: path.join(artifacts, `${pathname.slice(1)}-mobile-offline.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/limited-keys`);
  await page.getByRole("button", { name: "电脑授权", exact: true }).first().click();
  await page.getByText("尚无电脑登记。新版软件联网验证密钥时登记。", { exact: true }).waitFor();
  await page.getByRole("dialog").getByLabel("最多可用电脑数").fill("0");
  let start = requests.length;
  await page.getByRole("button", { name: "保存上限", exact: true }).click();
  await waitForRequest("keys.setDeviceLimit", start, input => input?.maxDevices === 0 && input.keyType === "online");
  await page.getByText("暂无密钥数据", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1, "the device dialog remains usable after a row changes category");
  await page.getByRole("dialog").getByLabel("最多可用电脑数").fill("3");
  start = requests.length;
  await page.getByRole("button", { name: "保存上限", exact: true }).click();
  await waitForRequest("keys.setDeviceLimit", start, input => input?.maxDevices === 3);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "电脑授权", exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(artifacts, "limited-keys-desktop.png"), fullPage: true });
  await page.goto(`${origin}/limited-generate`);
  await page.getByLabel(/每把密钥最多可用电脑数|电脑数量上限/).waitFor();
  await page.screenshot({ path: path.join(artifacts, "limited-generate-desktop.png"), fullPage: true });

  role = "admin";
  for (const pathname of ["/limited-generate", "/limited-keys"]) {
    const start = requests.length;
    await page.goto(origin + pathname);
    await page.getByText(/仅.*超级管理员|无权访问|没有权限/).first().waitFor();
    assert.equal(await page.getByRole("tab", { name: "在线密钥", exact: true }).count(), 0, "unauthorized direct URL does not mount restricted pages");
    assert.equal(await page.getByRole("button", { name: "生成限制密钥", exact: true }).count(), 0, "restricted navigation is hidden from non-super-admins");
    assert(!requests.slice(start).some(item => /^(?:offlineKeys|keys)\.(?:list|generate)$/.test(item.procedure)), "unauthorized direct URL makes no key API calls");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log("Limited key UI checks passed: real navigation, ordinary/limited online and offline generation, published systems without customer selection, integer validation, populated list and CSV/JSON filters, refreshed categories after editing, v4 offline display, role guard, keyboard tabs, 390px layout; all API responses synthetic.");
  console.log(`Synthetic UI screenshots: ${artifacts}`);
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true });
  console.error({ artifacts, errors, unexpected, url: page?.url(), body: await page?.locator("body").innerText() });
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
