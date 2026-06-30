import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ensureDefaultSuperAdmin, ensureDefaultSensorTypes, ensureRsaKeyPair, ensureDeviceCodeRecordsTable, ensureFeedbackTable, createFeedback, getLicenseKeyByString, markLicenseKeyActivated, markLicenseKeyExpired, recordClientTimeAndDetectTamper, getSensorTypesGrouped } from "../db";
import { decodeLicenseKey } from "../../shared/crypto";

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
  const app = express();
  const server = createServer(app);
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
  app.post("/licenseCheck", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    const now = Date.now();
    const key = (req.body && req.body.key ? String(req.body.key) : "").trim();
    if (!key) {
      return res.status(400).json({ time: now, valid: false, status: "INVALID", reason: "缺少 key" });
    }
    // 客户端可选上报：本机时间（防回拨高水位）与自检篡改标记
    const clientTime = req.body && req.body.clientTime != null ? Number(req.body.clientTime) : undefined;
    const tamperReported = !!(req.body && req.body.tamper);

    // 用服务器时间判过期
    const decoded = decodeLicenseKey(key, now);
    // 解密失败/格式错误（无到期时间即视为无法解析）
    if (!decoded.valid && decoded.error && !decoded.expireTimestamp) {
      return res.json({ time: now, valid: false, status: "INVALID", reason: decoded.error });
    }

    let status: string = "UNKNOWN";
    let reason: string | undefined = decoded.valid ? undefined : "密钥已过期";
    let valid = decoded.valid;
    // 在线密钥到期以数据库 expireTimestamp 为权威（支持后台续期延长当前密钥）；
    // 无数据库记录或数据库异常时，退回密钥串里编码的日期（离线兜底）
    let effectiveExpire: number | null = decoded.expireTimestamp ?? null;

    try {
      const rec = await getLicenseKeyByString(key);
      if (rec) {
        status = rec.status;
        // 到期改以数据库为准（续期会更新这个字段）
        effectiveExpire = rec.expireTimestamp;
        const notExpired = now < rec.expireTimestamp;
        valid = notExpired;
        reason = notExpired ? undefined : "密钥已过期";
        // 防回拨/篡改检测：维护可信时间高水位；检测到回拨或客户端上报篡改 → 标记 TAMPERED（持久化）
        const tamperResult = await recordClientTimeAndDetectTamper({
          keyId: rec.id,
          clientTime,
          tamperReported,
          serverNow: now,
        });
        if (tamperResult) status = tamperResult.status;

        if (status === "REVOKED") {
          valid = false;
          reason = rec.revokeReason || "密钥已吊销";
        } else if (status === "SUSPENDED") {
          valid = false;
          reason = rec.suspendReason || "密钥已暂停";
        } else if (status === "TAMPERED") {
          valid = false;
          reason = rec.tamperReason || "密钥异常：检测到时间回拨或客户端篡改";
        } else if (!notExpired) {
          // 已过期（按数据库到期判定）：统一返回 EXPIRED 并持久化
          valid = false;
          status = "EXPIRED";
          reason = "密钥已过期";
          await markLicenseKeyExpired(rec.id);
        } else if (!rec.isActivated) {
          // 首次有效校验 → 标记为已激活（在线版"使用即激活"）
          await markLicenseKeyActivated(key);
          status = "ACTIVATED";
        }
      }
    } catch (e) {
      // DB 不可用时退化为只按过期判断，避免数据库抖动误锁所有在线设备
      status = "DB_ERROR";
    }

    const effectiveRemainingDays = effectiveExpire != null
      ? Math.ceil((effectiveExpire - now) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      time: now,
      valid,
      status,
      reason,
      expireTimestamp: effectiveExpire,
      remainingDays: effectiveRemainingDays,
      sensorTypes: decoded.sensorTypes ?? null,
      isAllTypes: decoded.isAllTypes ?? false,
    });
  });

  // 传感器类型清单接口（桌面端拉取动态传感器类型；后台可在"传感器类型管理"里增删，客户端自动同步）
  // 与 /serverTime、/licenseCheck 同款：纯 REST + CORS，桌面端一次 fetch 即可用，无需走 tRPC/superjson
  // 请求: GET /sensorTypes
  // 返回: { time, groups: [{ group, icon, items: [{ id, label, value }] }], flat: [{ label, value, group }], map: { value: label } }
  app.get("/sensorTypes", async (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
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
      res.json({ time: Date.now(), groups, flat, map });
    } catch (e) {
      // DB 不可用时返回空清单 + 错误标记，桌面端可回退到本地缓存
      res.status(500).json({ time: Date.now(), groups: [], flat: [], map: {}, error: "DB_ERROR" });
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
    await setupVite(app, server);
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
