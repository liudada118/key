import { afterEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createCaller() {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "contract-test-user",
    email: "contract-test@example.com",
    name: "合同测试用户",
    loginMethod: "local",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "http",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

describe("online key contract requirement", () => {
  afterEach(() => {
    delete process.env.KEY_REQUIRE_CONTRACT;
  });

  // 默认（未设置 KEY_REQUIRE_CONTRACT）：生成密钥不再与合同强绑定，普通账号无合同
  // 也能过掉这道闸。这里没有数据库，所以"过闸"的表现是继续往下走并撞到落库那一步，
  // 断言它不是 BAD_REQUEST 即可 —— 关键是不能再被合同校验挡住。
  it("allows single generation without a contract by default", async () => {
    const caller = createCaller();

    await expect(
      caller.keys.generate({
        sensorTypes: "hand",
        days: 30,
        category: "production",
      } as never)
    ).rejects.not.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows batch generation without a contract by default", async () => {
    const caller = createCaller();

    await expect(
      caller.keys.batchGenerate({
        sensorTypes: "hand",
        days: 30,
        category: "production",
        count: 2,
      } as never)
    ).rejects.not.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects single generation without a contract when KEY_REQUIRE_CONTRACT=true", async () => {
    process.env.KEY_REQUIRE_CONTRACT = "true";
    const caller = createCaller();

    await expect(
      caller.keys.generate({
        sensorTypes: "hand",
        days: 30,
        category: "production",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects batch generation without a contract when KEY_REQUIRE_CONTRACT=true", async () => {
    process.env.KEY_REQUIRE_CONTRACT = "true";
    const caller = createCaller();

    await expect(
      caller.keys.batchGenerate({
        sensorTypes: "hand",
        days: 30,
        category: "production",
        count: 2,
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // 开关关掉也不能放过"只传了一半合同参数"的请求：那是调用方 bug,不是无合同签发
  it("still rejects a half-specified contract when binding is not required", async () => {
    const caller = createCaller();

    await expect(
      caller.keys.generate({
        sensorTypes: "hand",
        days: 30,
        category: "production",
        contractNo: "HT-2026-0001",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
