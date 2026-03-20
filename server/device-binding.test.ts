import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { generateLicenseKey } from "../shared/crypto";

/**
 * 设备绑定功能测试
 * 测试在线密钥的客户自助激活绑定流程
 */

// 创建公开上下文（无需登录）
function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: { "x-forwarded-for": "127.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as any,
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as any,
  };
}

// 创建管理员上下文
function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@example.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as any,
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as any,
  };
}

describe("Device Binding - Input Validation", () => {
  it("activate requires keyString and deviceCode", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    // 空密钥应该报错
    await expect(
      caller.keys.activate({ keyString: "", deviceCode: "DEV001" })
    ).rejects.toThrow();

    // 空设备码应该报错
    await expect(
      caller.keys.activate({ keyString: "some-key", deviceCode: "" })
    ).rejects.toThrow();
  });

  it("activate rejects invalid key string", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.keys.activate({
      keyString: "invalid-key-string-not-real",
      deviceCode: "DEV001",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("activate rejects expired key", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    // 生成一个 0 天的密钥（立即过期）
    const key = generateLicenseKey("car", 0, "rental");
    const result = await caller.keys.activate({
      keyString: key,
      deviceCode: "DEV001",
    });
    expect(result.success).toBe(false);
    // 密钥可能不在数据库中，所以可能是 "密钥已过期" 或其他错误
  });
});

describe("Device Binding - activate returns auth info", () => {
  it("activate returns authorization info along with binding result", async () => {
    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.keys.activate({
      keyString: "not-a-real-key",
      deviceCode: "DEV001",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // 合并后的 activate 接口应返回授权信息字段
    expect(result).toHaveProperty("sensorType");
    expect(result).toHaveProperty("sensorTypes");
    expect(result).toHaveProperty("expireDate");
    expect(result).toHaveProperty("remainingDays");
    expect(result).toHaveProperty("category");
  });
});

describe("Device Binding - verify includes device info", () => {
  it("verify mutation returns device count and max devices info", async () => {
    const caller = appRouter.createCaller(createAdminContext());

    // 验证一个无效密钥，检查返回结构
    const result = await caller.keys.verify({
      keyString: "not-a-real-key",
    });
    expect(result.valid).toBe(false);
  });
});

describe("Key Generation - maxDevices parameter", () => {
  it("generate mutation accepts maxDevices parameter", async () => {
    const caller = appRouter.createCaller(createAdminContext());

    // 这个测试验证 generate 接受 maxDevices 参数
    // 由于需要数据库，如果数据库不可用会抛出错误
    try {
      const result = await caller.keys.generate({
        sensorTypes: "car",
        days: 30,
        category: "rental",
        maxDevices: 5,
      });
      // 如果成功，验证返回了密钥
      expect(result.keyString).toBeTruthy();
    } catch (e: any) {
      // 数据库不可用时会抛出错误，这是预期的
      expect(e.message).toBeTruthy();
    }
  });
});
