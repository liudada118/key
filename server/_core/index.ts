import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ensureDefaultSuperAdmin, ensureDefaultSensorTypes, ensureRsaKeyPair, getLicenseKeyByString, markLicenseKeyActivated, recordClientTimeAndDetectTamper, getSensorTypesGrouped } from "../db";
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

    try {
      const rec = await getLicenseKeyByString(key);
      if (rec) {
        status = rec.status;
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
        } else if (valid && !rec.isActivated) {
          // 首次有效校验 → 标记为已激活（在线版"使用即激活"）
          await markLicenseKeyActivated(key);
          status = "ACTIVATED";
        }
      }
    } catch (e) {
      // DB 不可用时退化为只按过期判断，避免数据库抖动误锁所有在线设备
      status = "DB_ERROR";
    }

    res.json({
      time: now,
      valid,
      status,
      reason,
      expireTimestamp: decoded.expireTimestamp ?? null,
      remainingDays: decoded.remainingDays ?? null,
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
