import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import { usageReadScope } from "./usageAccess";
import { usageFiltersSchema } from "./usageSchema";
import { getUsageAnalysisSummary, getUsageCollectionOutcome, getUsageDashboard, getUsageEventContext, getUsageOverview, listUsageCustomerUsage,
  listUsageCustomers, listUsageEvents, listUsageFeatureUsage, listUsageSystems } from "./usageStore";

const usageReader = protectedProcedure.use(({ ctx, next }) => {
  const usageScope = usageReadScope(ctx.user);
  ctx.res.setHeader("Cache-Control", "no-store");
  return next({ ctx: { ...ctx, usageScope } });
});

const listInput = z.object({ filters: usageFiltersSchema,
  page: z.number().int().min(1).max(100000).default(1),
  sort: z.enum(["recent", "usage", "errors"]).default("recent"),
});

export const usageRouter = router({
  customers: usageReader.query(({ ctx }) => listUsageCustomers(ctx.usageScope)),
  overview: usageReader.input(usageFiltersSchema).query(({ ctx, input }) => getUsageOverview(ctx.usageScope, input)),
  summary: usageReader.input(usageFiltersSchema).query(({ ctx, input }) => getUsageAnalysisSummary(ctx.usageScope, input)),
  dashboard: usageReader.input(usageFiltersSchema).query(({ ctx, input }) => getUsageDashboard(ctx.usageScope, input)),
  customerUsage: usageReader.input(listInput.strict()).query(({ ctx, input }) => listUsageCustomerUsage(ctx.usageScope, input)),
  featureUsage: usageReader.input(listInput.extend({ category: z.enum(["all", "business", "diagnostic"]).default("business") }).strict())
    .query(({ ctx, input }) => listUsageFeatureUsage(ctx.usageScope, input)),
  systems: usageReader.input(usageFiltersSchema).query(({ ctx, input }) => listUsageSystems(ctx.usageScope, input)),
  events: usageReader.input(z.object({ filters: usageFiltersSchema, errorsOnly: z.boolean().default(false),
    page: z.number().int().min(1).max(100000).default(1),
  }).strict()).query(({ ctx, input }) => listUsageEvents(ctx.usageScope, input)),
  context: usageReader.input(z.object({ sourceId: z.number().int().positive(), installationId: z.string().uuid(), eventId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const context = await getUsageEventContext(ctx.usageScope, input);
      if (!context) throw new TRPCError({ code: "NOT_FOUND", message: "事件不存在" });
      return context;
    }),
  collectionOutcome: usageReader.input(z.object({ sourceId: z.number().int().positive(), installationId: z.string().uuid(),
    collectionId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/) }).strict()).query(async ({ ctx, input }) => {
    const outcome = await getUsageCollectionOutcome(ctx.usageScope, input);
    if (!outcome) throw new TRPCError({ code: "NOT_FOUND", message: "采集终态不存在" });
    return outcome;
  }),
});
