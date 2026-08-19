import { describe, expect, it } from "vitest";
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
  it("rejects single generation without a contract", async () => {
    const caller = createCaller();

    await expect(
      caller.keys.generate({
        sensorTypes: "hand",
        days: 30,
        category: "production",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects batch generation without a contract", async () => {
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
});
