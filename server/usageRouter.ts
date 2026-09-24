import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "./_core/trpc";
import { usageFiltersSchema } from "./usageSchema";
import { getUsageEventContext, getUsageOverview, listUsageCustomers, listUsageEvents } from "./usageStore";

const usageAdmin = superAdminProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "账号已被禁用" });
  ctx.res.setHeader("Cache-Control", "no-store");
  return next({ ctx });
});

export const usageRouter = router({
  customers: usageAdmin.query(() => listUsageCustomers()),
  overview: usageAdmin.input(usageFiltersSchema).query(({ input }) => getUsageOverview(input)),
  events: usageAdmin.input(z.object({ filters: usageFiltersSchema, errorsOnly: z.boolean().default(false),
    page: z.number().int().min(1).max(100000).default(1),
  }).strict()).query(({ input }) => listUsageEvents(input)),
  context: usageAdmin.input(z.object({ sourceId: z.number().int().positive(), installationId: z.string().uuid(), eventId: z.string().uuid() }).strict())
    .query(async ({ input }) => {
      const context = await getUsageEventContext(input);
      if (!context) throw new TRPCError({ code: "NOT_FOUND", message: "事件不存在" });
      return context;
    }),
});
