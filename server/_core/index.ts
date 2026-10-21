import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { ensureDefaultSuperAdmin, ensureDefaultSensorTypes, ensureRsaKeyPair, ensureDeviceCodeRecordsTable, ensureFeedbackTable, createFeedback, ensureSdkRequestsTable, createSdkRequest, getSensorTypesGrouped } from "../db";
import {
  LICENSE_GROUP_META,
  SENSOR_LABELS,
  getLicenseGroupOptions,
  getLicenseSensorGroups,
} from "../../shared/licenseScopes";
import { getLicenseRegistryInfo, loadLicenseRegistry } from "../licenseRegistry";
import { registerFeishuKeyRequestCardCallback } from "../feishuKeyRequestCardCallback";
import { registerAgentSync } from "../agentSync";
import { registerSystemPackages } from "../systemPackages";
import { registerUsage } from "../usage";
import { registerOfflineDeviceChecks } from "../licenseDevices";
import { registerFrontendUpdates } from "../frontendUpdates";
import { registerAgentModelCatalog } from "../agentModelCatalog";
import { registerAlgorithmPlatform } from "../algorithmPlatform";
import { registerOnlineLicenseCheck } from "../onlineLicenseCheck";
import { startUploadRetentionWorker } from "../uploadRetention";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // 分类授权注册表必须在任何签发/校验之前就位。
  // 故意放在下面数据库初始化的 try/catch 之外：注册表非法时要 fail-fast 让进程起不来，
  // 绝不能退回空清单继续签发（文档 §11）。
  loadLicenseRegistry();

  const app = express();
  const server = createServer(app);
  app.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, commit: process.env.KEY_MANAGER_BUILD_SHA || null });
  });
  // 飞书验签需要原始请求体，因此必须在全局 JSON 解析器之前注册。
  registerFeishuKeyRequestCardCallback(app);
  registerAgentSync(app);
  registerSystemPackages(app);
  registerUsage(app);
  registerFrontendUpdates(app);
  registerAgentModelCatalog(app);
  registerAlgorithmPlatform(app);
  registerOfflineDeviceChecks(app);
  startUploadRetentionWorker();
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // 初始化数据库：确保默认超级管理员存在
  try {
    await ensureDefaultSuperAdmin();
    await ensureDefaultSensorTypes();
    await ensureRsaKeyPair();
    await ensureDeviceCodeRecordsTable();
    await ensureFeedbackTable();
    await ensureSdkRequestsTable();
    console.log("[Init] Database initialization complete");
  } catch (error) {
    console.warn("[Init] Database initialization failed (will retry on first request):", error);
  }

  // 服务器时间接口（在线版客户端校时用，权威时间源；防客户端改本地时间）
  // 返回 { time: <毫秒时间戳>, iso: <ISO字符串> }
  app.get("/serverTime", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    const now = Date.now();
    res.json({ time: now, iso: new Date(now).toISOString() });
  });

  // 在线版授权校验接口（带密钥）：一次返回服务器时间 + 密钥状态，支持后台远程吊销/暂停
  // 请求: POST /licenseCheck  body: { key: string }
  // 返回: { time, valid, status, reason?, expireTimestamp, remainingDays, sensorTypes, isAllTypes }
  //   status: ISSUED/ACTIVATED/SUSPENDED/EXPIRED/REVOKED/UNKNOWN(库里无此密钥)/DB_ERROR/INVALID
  registerOnlineLicenseCheck(app);

  // 传感器类型清单接口（桌面端拉取动态传感器类型；后台可在"传感器类型管理"里增删，客户端自动同步）
  // 与 /serverTime、/licenseCheck 同款：纯 REST + CORS，桌面端一次 fetch 即可用，无需走 tRPC/superjson
  // 请求: GET /sensorTypes
  // 返回: { time, groups: [{ group, groupKey, icon, items: [{ id, label, value }] }],
  //        flat: [{ label, value, group }], map: { value: label },
  //        licenseGroups: [{ key, token, label, icon, sensorTypes }], registrySha256 }
  app.get("/sensorTypes", async (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    const registry = getLicenseRegistryInfo();
    const licenseGroups = getLicenseGroupOptions();
    try {
      const groups = await getSensorTypesGrouped();
      const flat: { label: string; value: string; group: string }[] = [];
      const map: Record<string, string> = {};
      for (const g of groups) {
        for (const it of g.items) {
          flat.push({ label: it.label, value: it.value, group: g.group });
          map[it.value] = it.label;
        }
      }
      res.json({
        time: Date.now(),
        groups,
        flat,
        map,
        licenseGroups,
        registrySha256: registry.sha256,
      });
    } catch (e) {
      // DB 不可用时用注册表派生清单兜底（文档 §7：flat 不能为空，否则桌面端会以为一个系统都没授权）
      const groups = getLicenseSensorGroups().map((group) => ({
        group: LICENSE_GROUP_META[group.key]?.dbGroupName || group.key,
        groupKey: group.key,
        icon: group.icon || "📦",
        items: group.items.map((item) => ({
          id: -1,
          label: SENSOR_LABELS[item.value] || item.value,
          value: item.value,
        })),
      }));
      const flat: { label: string; value: string; group: string }[] = [];
      const map: Record<string, string> = {};
      for (const g of groups) {
        for (const it of g.items) {
          flat.push({ label: it.label, value: it.value, group: g.group });
          map[it.value] = it.label;
        }
      }
      console.error("[sensorTypes] DB 不可用，回退到注册表派生清单:", e);
      res.json({
        time: Date.now(),
        groups,
        flat,
        map,
        licenseGroups,
        registrySha256: registry.sha256,
        source: "registry-fallback",
        error: "DB_ERROR",
      });
    }
  });

  // 用户反馈接收接口（桌面端开屏门户页提交）
  // 与 /sensorTypes 同款：纯 REST + CORS，桌面端一次 fetch 即可；无需鉴权（公开提交）
  // 请求: POST /feedback  body: { type, content, contact?, licenseKeyTail?, solution?, appVersion?, platform?, source?, userAgent? }
  // 返回: { ok: true, id } | { ok: false, error }
  app.options("/feedback", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
  });
  app.post("/feedback", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    try {
      const body = req.body || {};
      const content = (body.content != null ? String(body.content) : "").trim();
      if (!content) {
        return res.status(400).json({ ok: false, error: "缺少反馈内容" });
      }
      const allowedTypes = ["功能建议", "问题反馈", "商务合作", "其他"];
      const type = allowedTypes.includes(body.type) ? body.type : "其他";

      // 取来源 IP（兼容反向代理）
      const xff = req.headers["x-forwarded-for"];
      const ipAddress = (Array.isArray(xff) ? xff[0] : xff || req.socket.remoteAddress || "")
        .toString()
        .split(",")[0]
        .trim()
        .slice(0, 64);

      const truncate = (val: unknown, max: number) =>
        val != null ? String(val).slice(0, max) : undefined;

      const id = await createFeedback({
        type,
        content: content.slice(0, 2000),
        contact: truncate(body.contact, 128),
        licenseKeyTail: truncate(body.licenseKeyTail, 32),
        solution: truncate(body.solution, 64),
        appVersion: truncate(body.appVersion, 32),
        platform: truncate(body.platform, 32),
        source: truncate(body.source, 64) || "desktop-portal",
        userAgent: truncate(body.userAgent, 512),
        ipAddress,
      });
      res.json({ ok: true, id });
    } catch (e) {
      console.error("[Feedback] 提交失败:", e);
      res.status(500).json({ ok: false, error: "服务暂不可用，请稍后重试" });
    }
  });

  // SDK 获取登记接口（开发者站点 shroomSDKWEB 点「获取 SDK」时提交）
  // 与 /feedback 同款：纯 REST + CORS，站点一次 fetch 即可；无需鉴权（公开提交）
  // 注意这不是审批 —— 站点那边填完表单当场就开始下载，这里失败也不会挡住用户拿到 SDK。
  // 请求: POST /sdk-requests  body: { name, phone?, email?, organization?, sdkVersion?, source?, userAgent? }
  // 返回: { ok: true, id } | { ok: false, error }
  app.options("/sdk-requests", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
  });
  app.post("/sdk-requests", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    try {
      const body = req.body || {};
      const name = (body.name != null ? String(body.name) : "").trim();
      const phone = (body.phone != null ? String(body.phone) : "").trim();
      const email = (body.email != null ? String(body.email) : "").trim();
      if (!name) {
        return res.status(400).json({ ok: false, error: "缺少姓名" });
      }
      // 手机和邮箱至少留一个，否则这条线索没法跟进，存下来也没意义
      if (!phone && !email) {
        return res.status(400).json({ ok: false, error: "请至少留一个联系方式" });
      }

      // 取来源 IP（兼容反向代理）
      const xff = req.headers["x-forwarded-for"];
      const ipAddress = (Array.isArray(xff) ? xff[0] : xff || req.socket.remoteAddress || "")
        .toString()
        .split(",")[0]
        .trim()
        .slice(0, 64);

      const truncate = (val: unknown, max: number) =>
        val != null ? String(val).slice(0, max) : undefined;

      const id = await createSdkRequest({
        name: name.slice(0, 128),
        phone: phone.slice(0, 64) || undefined,
        email: email.slice(0, 128) || undefined,
        organization: truncate(body.organization, 255),
        sdkVersion: truncate(body.sdkVersion, 32),
        source: truncate(body.source, 64) || "sdk-web",
        userAgent: truncate(req.headers["user-agent"], 512),
        referer: truncate(req.headers.referer, 512),
        ipAddress,
      });
      res.json({ ok: true, id });
    } catch (e) {
      console.error("[SdkRequest] 提交失败:", e);
      res.status(500).json({ ok: false, error: "服务暂不可用，请稍后重试" });
    }
  });

  // 本地登录路由
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await (await import("./vite")).setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
