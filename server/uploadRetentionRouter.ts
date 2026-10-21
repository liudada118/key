import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "./_core/trpc";
import { cleanupExpiredUploads, deleteUploadedIdentity, listUploadDeletionAudit, uploadRetentionPolicy } from "./uploadRetention";

const admin = superAdminProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "账号已停用" });
  ctx.res.setHeader("Cache-Control", "no-store");
  return next({ ctx });
});

/** Administrator-only deletion and preview; request confirmation is never inferred from a read. */
export const uploadRetentionRouter = router({
  policy: admin.query(() => uploadRetentionPolicy()),
  audit: admin.query(() => listUploadDeletionAudit()),
  cleanup: admin.input(z.object({ dryRun: z.boolean().default(true), limit: z.number().int().min(1).max(500).default(100),
    confirmation: z.literal("DELETE_EXPIRED_UPLOADS").optional() }).strict()).mutation(({ input, ctx }) => {
    if (!input.dryRun && input.confirmation !== "DELETE_EXPIRED_UPLOADS") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "请先预览并确认清理过期上传" });
    }
    return cleanupExpiredUploads({ ...input, actorId: ctx.user.id });
  }),
  delete: admin.input(z.object({ kind: z.enum(["chat", "usage"]), sourceId: z.number().int().positive(),
    installationId: z.string().uuid(), objectId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),
    confirmation: z.literal("DELETE_UPLOADED_DATA") }).strict()).mutation(({ input, ctx }) => deleteUploadedIdentity(input, ctx.user.id)),
});
