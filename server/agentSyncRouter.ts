import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "./_core/trpc";
import { AgentSyncError, getAgentConversation, issueUploadCredential, listAgentChatCustomers, listAgentConversations, listUploadCredentials, revokeUploadCredential } from "./agentSyncStore";

const credentialAdmin = superAdminProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "账号已被禁用" });
  ctx.res.setHeader("Cache-Control", "no-store");
  return next({ ctx });
});

export const agentSyncRouter = router({
  chatCustomers: credentialAdmin.query(() => listAgentChatCustomers()),
  conversations: credentialAdmin.input(z.object({
    customerId: z.number().int().positive().optional(),
    page: z.number().int().min(1).max(1000000).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
  })).query(({ input }) => listAgentConversations(input)),
  conversation: credentialAdmin.input(z.object({
    customerId: z.number().int().positive(), installationId: z.string().uuid(),
    conversationId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),
    messagePage: z.number().int().min(1).max(1000).default(1),
    taskPage: z.number().int().min(1).max(1000).default(1),
  })).query(async ({ input }) => {
    const conversation = await getAgentConversation(input);
    if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "会话不存在" });
    return conversation;
  }),
  issueCredential: credentialAdmin.input(z.object({
    customerId: z.number().int().positive(), name: z.string().trim().min(1).max(128),
    days: z.number().int().min(1).max(365).default(90),
  })).mutation(async ({ ctx, input }) => {
    try {
      return await issueUploadCredential({ tenantId: input.customerId, name: input.name, days: input.days, createdById: ctx.user.id });
    } catch (error) {
      if (error instanceof AgentSyncError && error.status === 400) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "客户不存在或已停用" });
      }
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "上传凭证签发失败" });
    }
  }),
  listCredentials: credentialAdmin.input(z.object({ customerId: z.number().int().positive() }))
    .query(({ input }) => listUploadCredentials(input.customerId)),
  revokeCredential: credentialAdmin.input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => { await revokeUploadCredential(input.id); return { success: true }; }),
});
