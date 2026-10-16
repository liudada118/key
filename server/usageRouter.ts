import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "./_core/trpc";
import { usageFiltersSchema } from "./usageSchema";
import { getUsageAnalysisSummary, getUsageDashboard, getUsageEventContext, getUsageOverview, listUsageCustomerUsage,
  listUsageCustomers, listUsageEvents, listUsageFeatureUsage, listUsageSystems } from "./usageStore";

const usageAdmin = superAdminProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "账号已被禁用" });
  ctx.res.setHeader("Cache-Control", "no-store");
  return next({ ctx });
});

const listInput = z.object({ filters: usageFiltersSchema,
  page: z.number().int().min(1).max(100000).default(1),
  sort: z.enum(["recent", "usage", "errors"]).default("recent"),
});

export const usageRouter = router({
  customers: usageAdmin.query(() => listUsageCustomers()),
  overview: usageAdmin.input(usageFiltersSchema).query(({ input }) => getUsageOverview(input)),
  summary: usageAdmin.input(usageFiltersSchema).query(({ input }) => getUsageAnalysisSummary(input)),
  dashboard: usageAdmin.input(usageFiltersSchema).query(({ input }) => getUsageDashboard(input)),
  customerUsage: usageAdmin.input(listInput.strict()).query(({ input }) => listUsageCustomerUsage(input)),
  featureUsage: usageAdmin.input(listInput.extend({ category: z.enum(["all", "business", "diagnostic"]).default("business") }).strict())
    .query(({ input }) => listUsageFeatureUsage(input)),
  systems: usageAdmin.input(usageFiltersSchema).query(({ input }) => listUsageSystems(input)),
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
