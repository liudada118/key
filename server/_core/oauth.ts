import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

/**
 * 注册本地登录/注册路由（替代 Manus OAuth）
 */
export function registerOAuthRoutes(app: Express) {
  /** POST /api/auth/login - 用户名密码登录 */
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        res.status(400).json({ error: "用户名和密码不能为空" });
        return;
      }

      const user = await db.verifyUserCredentials(username, password);
      if (!user) {
        res.status(401).json({ error: "用户名或密码错误" });
        return;
      }

      if (!user.isActive) {
        res.status(403).json({ error: "账号已被禁用" });
        return;
      }

      const sessionToken = await sdk.createSessionToken(user.id, {
        username: user.username,
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "登录失败" });
    }
  });

  /** 兼容旧的 OAuth 回调路由（重定向到登录页） */
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    res.redirect(302, "/login");
  });
}
