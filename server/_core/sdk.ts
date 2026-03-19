import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { COOKIE_NAME } from "@shared/const";

export type SessionPayload = {
  userId: number;
  username: string;
  name: string;
};

class AuthService {
  private jwtSecret: Uint8Array;

  constructor() {
    const secret = ENV.cookieSecret || "default-jwt-secret-change-me";
    this.jwtSecret = new TextEncoder().encode(secret);
  }

  /** 创建 JWT session token */
  async createSessionToken(
    userId: number,
    opts: { username: string; name: string; expiresInMs: number }
  ): Promise<string> {
    const payload: SessionPayload = {
      userId,
      username: opts.username,
      name: opts.name,
    };

    const token = await new SignJWT(payload as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Date.now() + opts.expiresInMs)
      .sign(this.jwtSecret);

    return token;
  }

  /** 验证 JWT token 并返回 payload */
  async verifyToken(token: string): Promise<SessionPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret);
      return payload as unknown as SessionPayload;
    } catch {
      return null;
    }
  }

  /** 从请求中认证用户 */
  async authenticateRequest(req: Request): Promise<User | null> {
    const rawCookies = req.headers.cookie;
    if (!rawCookies) return null;

    const cookies = parseCookieHeader(rawCookies);
    const sessionCookie = cookies[COOKIE_NAME];
    if (!sessionCookie) return null;

    const payload = await this.verifyToken(sessionCookie);
    if (!payload) return null;

    const user = await db.getUserById(payload.userId);
    if (!user) return null;
    if (!user.isActive) return null;

    return user;
  }
}

export const sdk = new AuthService();
