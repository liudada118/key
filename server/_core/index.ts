import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ensureDefaultSuperAdmin, ensureDefaultSensorTypes, ensureRsaKeyPair, getLicenseKeyByString, markLicenseKeyActivated } from "../db";
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
        if (rec.status === "REVOKED") {
          valid = false;
          reason = rec.revokeReason || "密钥已吊销";
        } else if (rec.status === "SUSPENDED") {
          valid = false;
          reason = rec.suspendReason || "密钥已暂停";
        }
        // 首次有效校验 → 标记为已激活（在线版"使用即激活"）
        if (valid && !rec.isActivated) {
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
