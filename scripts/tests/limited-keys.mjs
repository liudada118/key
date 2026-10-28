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
const creatorsOnly = process.argv.includes("--creators-only");
const tamperedOnly = process.argv.includes("--tampered-only");
const notificationsOnly = process.argv.includes("--notifications-only");
const timesOnly = process.argv.includes("--times-only");
let requestRows = [];
let readReceiptFailure = false;
let restoreFailure = true;
let tamperedRows = [{ id: 7349, keyString: "SYNTHETIC-NOT-A-LICENSE", customerName: "合成恢复客户", sensorType: "hand", status: "TAMPERED",
  expireTimestamp: Date.now() + 86400000, tamperedAt: new Date(), reportedClientTime: Date.now() - 13 * 60000,
  tamperServerTime: Date.now(), tamperReason: "合成时间回拨记录", statusBeforeTamper: "ACTIVATED" }];
const creators = [{ id: 91, name: "测试人员", username: "issuer-a" }, { id: 92, name: "测试人员", username: "issuer-b" }];

/** Produce populated lists, including a v4 offline code whose allowance was lifted. */
function records(procedure, input) {
  const offline = procedure.startsWith("offlineKeys");
  const current = limits[offline ? "offline" : "online"];
  const base = { keyString: "SYNTHETIC-NOT-A-LICENSE", activationCode: "SYNTHETIC-NOT-AN-ACTIVATION-CODE", sensorType: "hand", sensorTypes: "hand", days: 30,
    expireTimestamp: Date.now() + 86400000, expireDate: Date.now() + 86400000, createdAt: new Date(), status: "ISSUED", createdByName: "合成验收账号", customerName: "合成客户", customerId: 1 };
  if (creatorsOnly) {
    const all = Array.from({ length: 45 }, (_, index) => ({ ...base, id: index + 1, createdById: index < 24 ? 91 : 92,
      customerName: index < 24 ? "客户甲" : "客户乙", createdByName: "测试人员", deviceLimit: input.deviceMode === "limited" ? 3 : 0,
      deviceRestricted: input.deviceMode === "limited" }));
    const visible = all.filter(item => input.createdById === undefined || item.createdById === input.createdById);
    const pageSize = input.pageSize || 20, page = input.page || 1;
    return { items: visible.slice((page - 1) * pageSize, page * pageSize), total: visible.length, page, pageSize };
  }
  const all = [{ ...base, id: 101, deviceLimit: 0, deviceRestricted: false }, { ...base, id: 102, deviceLimit: current, deviceRestricted: offline || current > 0 }];
  if (offline) all.push({ ...base, id: 103, deviceLimit: 0, deviceRestricted: true });
  if (timesOnly) {
    for (const item of all) {
      item.createdAt = new Date(item.deviceRestricted ? "2026-10-27T16:10:11Z" : "2026-10-27T09:52:24Z");
      item.expireTimestamp = item.expireDate = item.createdAt.getTime() + 30 * 86400000;
    }
  }
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
    case "keys.creators": return creators;
    case "keys.tamperedList": return { items: tamperedRows, total: tamperedRows.length };
    case "keys.tamperedCount": return tamperedRows.length;
    case "keyGenerationRequests.notifications": return {
      pending: role === "super_admin" ? requestRows.filter(row => row.status === "PENDING").length : 0,
      approved: requestRows.filter(row => row.requestedById === user.id && row.status === "APPROVED" && !row.resultReadAt).length,
    };
    case "keyGenerationRequests.list": {
      const visible = requestRows.filter(row => (role === "super_admin" || row.requestedById === user.id) && (!input.status || row.status === input.status));
      return { items: visible.slice((input.page - 1) * input.pageSize, input.page * input.pageSize), total: visible.length };
    }
    case "keyGenerationRequests.markResultsRead":
      for (const row of requestRows) {
        if (row.requestedById === user.id && row.status === "APPROVED" && input.ids.includes(row.id)) row.resultReadAt = new Date();
      }
      return { success: true };
    case "keyGenerationRequests.review": {
      const row = requestRows.find(row => row.id === input.id);
      row.status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      row.generatedKeyCount = row.status === "APPROVED" ? 1 : 0;
      return row;
    }
    case "keys.clearTamper": tamperedRows = tamperedRows.filter(row => row.id !== input.keyId); return { success: true, key: { id: input.keyId, status: "ACTIVATED" } };
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
    if (procedures.includes("keys.clearTamper")) await new Promise(resolve => setTimeout(resolve, 400));
    const results = procedures.map((procedure, index) => {
      const input = superjson.deserialize(inputs[index] || { json: null });
      if (procedure === "keyGenerationRequests.markResultsRead" && readReceiptFailure) {
        requests.push({ procedure, input });
        return { error: superjson.serialize({ message: "Synthetic read receipt failure", code: -32603,
          data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: procedure } }) };
      }
      if (procedure === "keys.clearTamper" && restoreFailure) {
        requests.push({ procedure, input });
        return { error: superjson.serialize({ message: "合成恢复失败，请重试", code: -32603,
          data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: procedure } }) };
      }
      return { result: { data: superjson.serialize(reply(procedure, input)) } };
    });
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

/** Exercise real creator menus, pagination, combination, exports and responsive layout using synthetic records. */
async function verifyCreatorFilters(origin) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const pathname of ["/keys", "/offline-key-list", "/limited-keys", "/limited-keys?type=offline"]) {
      const offline = pathname.includes("offline"), procedure = offline ? "offlineKeys.list" : "keys.list";
      const mode = pathname.includes("limited") ? "limited" : "unlimited";
      let start = requests.length;
      await page.goto(origin + pathname);
      await waitForRequest("keys.creators", start, input => input.keyType === (offline ? "offline" : "online") && input.deviceMode === mode);
      await page.getByText("客户甲", { exact: true }).first().waitFor();
      const next = offline ? page.getByRole("button").filter({ has: page.locator("svg.lucide-chevron-right") }).last()
        : page.getByRole("button", { name: "下一页", exact: true });
      start = requests.length;
      await next.click();
      await waitForRequest(procedure, start, input => input.page === 2);
      await page.getByRole("checkbox", { name: "全选本页" }).click();
      await page.getByRole("button", { name: /删除选中/ }).waitFor();
      start = requests.length;
      await page.getByRole("combobox", { name: "按生成人员筛选" }).click();
      await page.getByRole("option", { name: "测试人员 (issuer-a)", exact: true }).waitFor();
      await page.getByRole("option", { name: "测试人员 (issuer-b)", exact: true }).click();
      const selected = await waitForRequest(procedure, start, input => input.createdById === 92);
      assert.equal(selected.input.page, 1, "changing creator resets pagination");
      assert.equal(selected.input.deviceMode, mode, "changing creator preserves device category");
      await page.getByText("客户乙", { exact: true }).first().waitFor();
      assert.equal(await page.getByText("客户甲", { exact: true }).count(), 0, "only the selected creator's records remain");
      assert.equal(await page.getByRole("button", { name: /删除选中/ }).count(), 0, "hidden records are not left selected");
      assert((await page.locator("body").innerText()).includes("21"), "filtered totals match the selected creator");
      await assertNoPageOverflow(pathname + " creator " + width);
      await page.screenshot({ path: path.join(artifacts, `creator-${offline ? "offline" : "online"}-${mode}-${width}.png`), fullPage: true });
      if (!offline) {
        await page.getByRole("combobox").filter({ hasText: "全部状态" }).click();
        start = requests.length;
        await page.getByRole("option", { name: "已签发", exact: true }).click();
        await waitForRequest(procedure, start, input => input.createdById === 92 && input.status === "ISSUED");
        start = requests.length;
        await page.getByPlaceholder("搜索密钥...").fill("客户乙");
        await page.getByRole("button", { name: "搜索", exact: true }).click();
        await waitForRequest(procedure, start, input => input.search === "客户乙" && input.createdById === 92);
        for (const format of ["CSV", "JSON"]) {
          start = requests.length;
          await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: format, exact: true }).click()]);
          const exported = (await waitForRequest("keys.export", start)).input;
          assert.equal(exported.createdById, 92);
          assert.equal(exported.status, "ISSUED");
          assert.equal(exported.search, "客户乙");
          assert.equal(exported.deviceMode, mode);
        }
      }
      start = requests.length;
      await page.getByRole("combobox", { name: "按生成人员筛选" }).click();
      await page.getByRole("option", { name: "全部人员", exact: true }).click();
      await waitForRequest(procedure, start, input => input.createdById === undefined && input.page === 1);
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log("Creator filtering passed: online/offline and ordinary/limited lists, duplicate names, page reset, selection reset, totals, combined filters, CSV/JSON, 1440px/390px screenshots; synthetic APIs only.");
}

/** Confirm restoration explicitly; cancellation and failures must never become issuance or revocation. */
async function verifyTamperedRecovery(origin) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(origin + "/tampered");
    await page.getByRole("button", { name: "恢复原密钥", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "恢复原密钥 #7349", exact: true }).waitFor();
    await dialog.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });
    assert((await dialog.innerText()).includes("不生成新密钥、不延长有效期"));
    await assertNoPageOverflow("tampered recovery " + width);
    await page.screenshot({ path: path.join(artifacts, `tampered-recovery-${width}.png`), fullPage: true });
    assert.equal(requests.filter(item => item.procedure === "keys.clearTamper").length, 0, "opening a dialog does not restore a key");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  assert.equal(requests.filter(item => item.procedure === "keys.clearTamper").length, 0, "cancel has no mutation");
  await page.getByRole("button", { name: "恢复原密钥", exact: true }).click();
  const dialog = page.getByRole("dialog"), confirm = dialog.getByRole("button", { name: "确认恢复原密钥", exact: true });
  let start = requests.length;
  await confirm.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')]
    .some(button => button.textContent.includes("确认恢复原密钥") && button.disabled));
  assert.equal(await confirm.isDisabled(), true, "pending recovery cannot be submitted twice");
  await page.keyboard.press("Escape");
  await dialog.waitFor();
  await waitForRequest("keys.clearTamper", start);
  await page.getByText("合成恢复失败，请重试", { exact: true }).waitFor();
  assert.equal(await dialog.count(), 1, "failure keeps the original target available for retry");
  assert.equal(await confirm.isEnabled(), true);
  restoreFailure = false;
  start = requests.length;
  await confirm.click();
  const call = await waitForRequest("keys.clearTamper", start);
  assert.deepEqual(call.input, { keyId: 7349 }, "recovery only identifies the original key");
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("暂无异常密钥", { exact: true }).waitFor();
  assert.equal(requests.filter(item => item.procedure === "keys.clearTamper").length, 2, "only confirmation and explicit retry submit");
  assert(!requests.some(item => ["keys.reissue", "keys.revoke", "keys.generate"].includes(item.procedure)), "restoring the original key does not issue or revoke keys");
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log("Tampered recovery passed: real page and confirmation, cancellation, pending guard, failure retry, original-key-only parameters, refreshed list, desktop/mobile screenshots; synthetic APIs only.");
}

async function verifyKeyTimes(origin) {
  for (const timezoneId of ["UTC", "America/Los_Angeles"]) {
    await page.close();
    page = await browser.newPage({ timezoneId, viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", mockRequests);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const pathname of ["/keys", "/offline-key-list", "/limited-keys", "/limited-keys?type=offline"]) {
        await page.goto(origin + pathname);
        const limited = pathname.startsWith("/limited-keys");
        const expectedTime = limited ? "2026/10/28 00:10:11" : "2026/10/27 17:52:24";
        const expectedDate = limited ? "2026/10/28" : "2026/10/27";
        const cell = page.locator(`td[title="${expectedTime}"]`).first();
        await cell.waitFor();
        assert.equal((await cell.innerText()).trim(), expectedDate, "creation day follows Beijing time, not the browser timezone");
        if (width === 390) await cell.scrollIntoViewIfNeeded();
        await assertNoPageOverflow(`key time ${timezoneId} ${width} ${pathname}`);
        await page.screenshot({ path: path.join(artifacts, `key-time-${timezoneId.replaceAll("/", "-")}-${width}-${pathname.slice(1).replaceAll(/[?=]/g, "-")}.png`), fullPage: true });
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log("Key time UI passed: Beijing dates and exact-time titles for online/offline ordinary/limited lists, UTC and America/Los_Angeles browsers, midnight boundary, 1440px/390px screenshots; synthetic APIs only.");
}

async function verifyNotifications(origin) {
  const approved = id => ({ id, requestNo: `KGR-FIXTURE-${id}`, requestedById: user.id, requestedByName: user.name,
    mode: "single", productType: "shroom-desktop", sensorTypes: '["hand"]', days: 30, count: 1,
    reason: "Synthetic notification fixture", status: "APPROVED", resultReadAt: null, reviewedAt: new Date(),
    generatedKeyCount: 1, createdAt: new Date("2026-10-26T09:43:10Z") });
  const notice = label => page.getByRole("button", { name: new RegExp(`^${label}，`) });
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !!window.__fixtureHidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__fixtureHidden ? "hidden" : "visible" });
  });
  requestRows = [{ ...approved(177), requestedById: 92, status: "PENDING", generatedKeyCount: 0 }];
  await page.goto(`${origin}/keys`);
  await notice("无合同申请").waitFor();
  await notice("异常密钥").waitFor();
  const onlineSection = page.locator('[data-slot="collapsible"]').filter({ hasText: "在线密钥" }).first();
  assert.equal(await onlineSection.getByRole("button", { name: /^异常密钥/ }).count(), 1);
  await page.screenshot({ path: path.join(artifacts, "notices-super-admin-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "收起导航", exact: true }).click();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const dot = notice("异常密钥").locator('[data-slot="navigation-notice"]');
  const [dotBox, buttonBox] = await Promise.all([dot.boundingBox(), notice("异常密钥").boundingBox()]);
  assert(buttonBox?.width <= 40, "collapsed navigation has finished resizing to an icon button");
  assert(dotBox && buttonBox && dotBox.x >= buttonBox.x && dotBox.x + dotBox.width <= buttonBox.x + buttonBox.width + 1, "collapsed notice stays inside its icon button");
  await page.screenshot({ path: path.join(artifacts, "notices-collapsed.png"), fullPage: true });
  await page.getByRole("button", { name: "展开导航", exact: true }).click();
  await notice("无合同申请").click();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "批准并生成", exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-sidebar="menu-button"]')].some(button => button.getAttribute("aria-label")?.includes("密钥申请待审批")));
  assert.equal(requests.filter(item => item.procedure === "keyGenerationRequests.markResultsRead").length, 0, "super admin viewing someone else's approval does not acknowledge it");
  await notice("异常密钥").waitFor();

  role = "user";
  requestRows = Array.from({ length: 21 }, (_, index) => approved(300 + index));
  await page.goto(`${origin}/keys`);
  await notice("无合同申请").waitFor();
  assert.equal(await page.getByRole("button", { name: /^异常密钥/ }).count(), 0, "child accounts retain their original navigation boundary");
  await page.screenshot({ path: path.join(artifacts, "notices-applicant-desktop.png"), fullPage: true });
  await page.evaluate(() => { window.__fixtureHidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  const hiddenStart = requests.length;
  await notice("无合同申请").click();
  await page.getByText("KGR-FIXTURE-300", { exact: true }).waitFor();
  assert(!requests.slice(hiddenStart).some(item => item.procedure === "keyGenerationRequests.markResultsRead"), "hidden pages never acknowledge results");
  readReceiptFailure = true;
  await page.evaluate(() => { window.__fixtureHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await waitForRequest("keyGenerationRequests.markResultsRead", hiddenStart);
  await notice("无合同申请").waitFor();
  assert.equal(requestRows.filter(row => !row.resultReadAt).length, 21, "failed read receipt retains every unread result");
  readReceiptFailure = false;
  await page.clock.fastForward(31_000);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-sidebar="menu-button"]')].some(button => button.getAttribute("aria-label") === "无合同申请，1 条申请已批准，结果未查看"));
  assert.equal(requestRows.filter(row => !row.resultReadAt).length, 1, "opening page one does not consume results on page two");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByText("KGR-FIXTURE-320", { exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-sidebar="menu-button"]')].some(button => button.getAttribute("aria-label") === "无合同申请"));
  assert.equal(requestRows.filter(row => !row.resultReadAt).length, 0);
  await page.reload();
  await page.getByRole("button", { name: "无合同申请", exact: true }).waitFor();
  assert.equal(await notice("无合同申请").count(), 0, "acknowledged state survives a new page session");

  role = "super_admin";
  requestRows = [{ ...approved(500), requestedById: 92, status: "PENDING" }];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/keys`);
  await page.getByRole("button", { name: /打开导航，.*密钥申请待审批/ }).click();
  await notice("无合同申请").waitFor();
  await notice("异常密钥").waitFor();
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  await assertNoPageOverflow("mobile notification sidebar");
  await page.screenshot({ path: path.join(artifacts, "notices-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log("Notification UI passed: role boundaries, super-admin approval, persistent applicant receipts, hidden-page guard, failure/retry, pagination, unresolved tamper notice, collapsed/mobile screenshots; all APIs synthetic.");
}

try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.SHROOM_TEST_BROWSER || "chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", mockRequests);

  if (timesOnly) {
    await verifyKeyTimes(origin);
  } else if (notificationsOnly) {
    await verifyNotifications(origin);
  } else if (tamperedOnly) {
    await verifyTamperedRecovery(origin);
  } else if (creatorsOnly) {
    await verifyCreatorFilters(origin);
  } else {
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
  }
  console.log(`Synthetic UI screenshots: ${artifacts}`);
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true });
  console.error({ artifacts, errors, unexpected, url: page?.url(), body: await page?.locator("body").innerText() });
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
