import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, superAdminProcedure } from "./_core/trpc";
import { registerLegacyOnlineLicense } from "./legacyLicenseImport";

const admin = superAdminProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
  ctx.res.setHeader("Cache-Control", "no-store");
  return next({ ctx });
});
const input = z.object({ keyString: z.string().trim().min(1).max(8192), reason: z.string().trim().min(5).max(500) });

/** Translate reviewed import failures without exposing the submitted key or database diagnostics. */
async function reviewedImport(options: Parameters<typeof registerLegacyOnlineLicense>[0]) {
  try { return await registerLegacyOnlineLicense(options); }
  catch (error) {
    const messages: Record<string, string> = {
      LICENSE_INVALID: "密钥格式无效，请核对原密钥。",
      LICENSE_INVALID_OR_EXPIRED: "原密钥已过期或授权范围无效，不能补录。",
      EXISTING_LICENSE_INACTIVE: "原密钥已有暂停、吊销、异常或到期记录，不能通过补录恢复。",
      REVIEW_REASON_REQUIRED: "请填写至少 5 个字的签发来源审核依据。",
      ACTIVE_SUPER_ADMIN_REQUIRED: "需要有效的超级管理员账号。",
    };
    const code = error instanceof Error ? error.message : "";
    throw new TRPCError({ code: code === "ACTIVE_SUPER_ADMIN_REQUIRED" ? "FORBIDDEN" : messages[code] ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
      message: messages[code] || "登记服务暂不可用，未完成登记，请稍后重试。" });
  }
}

/** Reuse the audited CLI service; only an active super administrator can confirm an unchanged preview. */
export const legacyLicenseImportRouter = router({
  preview: admin.input(input.strict()).mutation(({ input, ctx }) => reviewedImport({ ...input, operatorId: ctx.user.id })),
  register: admin.input(input.extend({ confirmedKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmation: z.literal("REGISTER_REVIEWED_LEGACY_KEY") }).strict()).mutation(({ input, ctx }) => {
    if (createHash("sha256").update(input.keyString).digest("hex") !== input.confirmedKeyHash) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "密钥已发生变化，请重新预览后确认。" });
    }
    return reviewedImport({ keyString: input.keyString, reason: input.reason, operatorId: ctx.user.id, apply: true });
  }),
});
