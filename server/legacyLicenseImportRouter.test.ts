import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { legacyLicenseImportRouter } from "./legacyLicenseImportRouter";
import { registerLegacyOnlineLicense } from "./legacyLicenseImport";
vi.mock("./legacyLicenseImport", () => ({ registerLegacyOnlineLicense: vi.fn(async () => ({ outcome: "DRY_RUN" })) }));

/** Build an isolated authenticated caller without cookies, real keys, or external services. */
function caller(role: string, active = true) {
  return legacyLicenseImportRouter.createCaller({ user: { id: 7, role, isActive: active }, res: { setHeader: vi.fn() } } as unknown as TrpcContext);
}
const keyString = "ab".repeat(64), reason = "已核对原签发台账及客户交付记录";
const confirmedKeyHash = createHash("sha256").update(keyString).digest("hex");
describe("reviewed legacy license web entry", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects ordinary administrators and inactive super administrators", async () => {
    for (const [role, active] of [["user", true], ["admin", true], ["super_admin", false]] as const) {
      await expect(caller(role, active).preview({ keyString, reason })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role, active).register({ keyString, reason, confirmedKeyHash, confirmation: "REGISTER_REVIEWED_LEGACY_KEY" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(registerLegacyOnlineLicense).not.toHaveBeenCalled();
  });
  it("previews through the same audited service without applying", async () => {
    await caller("super_admin").preview({ keyString, reason });
    expect(registerLegacyOnlineLicense).toHaveBeenCalledWith({ keyString, reason, operatorId: 7 });
  });
  it("requires explicit confirmation and rejects a key changed after preview", async () => {
    await expect(caller("super_admin").register({ keyString, reason, confirmedKeyHash: "a".repeat(64), confirmation: "REGISTER_REVIEWED_LEGACY_KEY" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(registerLegacyOnlineLicense).not.toHaveBeenCalled();
    await caller("super_admin").register({ keyString, reason, confirmedKeyHash, confirmation: "REGISTER_REVIEWED_LEGACY_KEY" });
    expect(registerLegacyOnlineLicense).toHaveBeenCalledWith({ keyString, reason, operatorId: 7, apply: true });
  });
  it("returns a safe inline reason without raw key or database details", async () => {
    vi.mocked(registerLegacyOnlineLicense).mockRejectedValueOnce(new Error("EXISTING_LICENSE_INACTIVE"));
    await expect(caller("super_admin").preview({ keyString, reason })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("不能通过补录恢复") });
    vi.mocked(registerLegacyOnlineLicense).mockRejectedValueOnce(new Error(`sql secret ${keyString}`));
    await expect(caller("super_admin").preview({ keyString, reason })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "登记服务暂不可用，未完成登记，请稍后重试。" });
  });
});
