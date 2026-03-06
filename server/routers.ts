import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router, superAdminProcedure } from "./_core/trpc";
import {
  activateLicenseKey,
  createAccount,
  createCustomer,
  getAllCustomers,
  getAllUsers,
  getCustomerById,
  getCustomerKeyCount,
  getCustomers,
  getKeyStats,
  getLicenseKeyByString,
  getLicenseKeys,
  getSubordinateUsers,
  getUserAndSubordinateIds,
  getUserById,
  insertLicenseKey,
  insertLicenseKeys,
  updateAccount,
  updateCustomer,
} from "./db";
import {
  decodeLicenseKey,
  generateLicenseKey,
  SENSOR_TYPES,
  SENSOR_GROUPS,
  ALL_SENSORS,
  SENSOR_LABEL_MAP,
  KEY_CATEGORIES,
  type KeyCategory,
} from "@shared/crypto";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ===== 账号管理 =====
  accounts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getSubordinateUsers(ctx.user.id, ctx.user.role);
    }),

    all: superAdminProcedure.query(async () => {
      return getAllUsers();
    }),

    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1, "名称不能为空"),
          role: z.enum(["admin", "user"]),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role === "admin" && input.role === "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "管理员只能创建子账号" });
        }
        return createAccount({
          name: input.name,
          role: input.role,
          createdById: ctx.user.id,
          remark: input.remark,
        });
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          isActive: z.boolean().optional(),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const target = await getUserById(input.id);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });

        if (ctx.user.role === "admin") {
          if (target.createdById !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "无权操作此账号" });
          }
        }
        if (ctx.user.role !== "super_admin" && target.role === "super_admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权操作超级管理员" });
        }

        return updateAccount(input.id, {
          name: input.name,
          isActive: input.isActive,
          remark: input.remark,
        });
      }),
  }),

  // ===== 客户管理 =====
  customers: router({
    /** 获取客户列表（分页） */
    list: protectedProcedure
      .input(
        z.object({
          page: z.number().min(1).default(1),
          pageSize: z.number().min(1).max(100).default(20),
          search: z.string().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        return getCustomers({
          userIds,
          page: input.page,
          pageSize: input.pageSize,
          search: input.search,
          isActive: input.isActive,
        });
      }),

    /** 获取所有活跃客户（用于下拉选择） */
    all: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getAllCustomers(userIds);
    }),

    /** 获取单个客户详情 */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const customer = await getCustomerById(input.id);
        if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });
        const keyCount = await getCustomerKeyCount(input.id);
        return { ...customer, keyCount };
      }),

    /** 创建客户 */
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1, "客户名称不能为空"),
          contactPerson: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          address: z.string().optional(),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return createCustomer({
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          email: input.email,
          address: input.address,
          remark: input.remark,
          createdById: ctx.user.id,
        });
      }),

    /** 更新客户 */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          contactPerson: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          address: z.string().optional(),
          remark: z.string().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const existing = await getCustomerById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });
        return updateCustomer(input.id, {
          name: input.name,
          contactPerson: input.contactPerson,
          phone: input.phone,
          email: input.email,
          address: input.address,
          remark: input.remark,
          isActive: input.isActive,
        });
      }),
  }),

  // ===== 密钥管理 =====
  keys: router({
    sensorTypes: publicProcedure.query(() => SENSOR_TYPES),
    sensorGroups: publicProcedure.query(() => SENSOR_GROUPS),
    categories: publicProcedure.query(() => KEY_CATEGORIES),

    /** 生成单个密钥（支持多选传感器类型 + 关联客户） */
    generate: protectedProcedure
      .input(
        z.object({
          sensorTypes: z.union([z.string(), z.array(z.string())]),
          days: z.number().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          customerId: z.number().optional(),
          customerName: z.string().optional(),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const keyString = generateLicenseKey(input.sensorTypes, input.days, input.category);
        const expireTimestamp = Date.now() + input.days * 24 * 60 * 60 * 1000;

        const sensorTypeStr = Array.isArray(input.sensorTypes)
          ? input.sensorTypes.join(",")
          : input.sensorTypes;

        // 获取客户名称
        let customerName = input.customerName || null;
        if (input.customerId && !customerName) {
          const customer = await getCustomerById(input.customerId);
          customerName = customer?.name || null;
        }

        await insertLicenseKey({
          keyString,
          sensorType: sensorTypeStr,
          category: input.category,
          days: input.days,
          expireTimestamp,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || "未知",
          customerId: input.customerId || null,
          customerName,
          remark: input.remark || null,
        });

        return { keyString, expireTimestamp };
      }),

    /** 批量生成密钥（支持多选传感器类型 + 关联客户） */
    batchGenerate: protectedProcedure
      .input(
        z.object({
          sensorTypes: z.union([z.string(), z.array(z.string())]),
          days: z.number().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          count: z.number().min(1).max(500),
          customerId: z.number().optional(),
          customerName: z.string().optional(),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const batchId = nanoid(12);
        const keys: { keyString: string; expireTimestamp: number }[] = [];
        const records: Parameters<typeof insertLicenseKeys>[0] = [];

        const sensorTypeStr = Array.isArray(input.sensorTypes)
          ? input.sensorTypes.join(",")
          : input.sensorTypes;

        // 获取客户名称
        let customerName = input.customerName || null;
        if (input.customerId && !customerName) {
          const customer = await getCustomerById(input.customerId);
          customerName = customer?.name || null;
        }

        for (let i = 0; i < input.count; i++) {
          const keyString = generateLicenseKey(input.sensorTypes, input.days, input.category);
          const expireTimestamp = Date.now() + input.days * 24 * 60 * 60 * 1000;
          keys.push({ keyString, expireTimestamp });
          records.push({
            keyString,
            sensorType: sensorTypeStr,
            category: input.category,
            days: input.days,
            expireTimestamp,
            createdById: ctx.user.id,
            createdByName: ctx.user.name || "未知",
            customerId: input.customerId || null,
            customerName,
            batchId,
            remark: input.remark || null,
          });
        }

        await insertLicenseKeys(records);
        return { batchId, keys, count: keys.length };
      }),

    /** 分级查询密钥列表 */
    list: protectedProcedure
      .input(
        z.object({
          page: z.number().min(1).default(1),
          pageSize: z.number().min(1).max(100).default(20),
          category: z.string().optional(),
          sensorType: z.string().optional(),
          isActivated: z.boolean().optional(),
          search: z.string().optional(),
          customerId: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        return getLicenseKeys({
          userIds,
          page: input.page,
          pageSize: input.pageSize,
          category: input.category,
          sensorType: input.sensorType,
          isActivated: input.isActivated,
          search: input.search,
          customerId: input.customerId,
        });
      }),

    /** 解密验证密钥 */
    verify: publicProcedure
      .input(z.object({ keyString: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const decoded = decodeLicenseKey(input.keyString);
        const dbRecord = await getLicenseKeyByString(input.keyString.trim());
        return {
          ...decoded,
          isActivated: dbRecord?.isActivated ?? false,
          activatedAt: dbRecord?.activatedAt ?? null,
          createdByName: dbRecord?.createdByName ?? null,
          customerName: dbRecord?.customerName ?? null,
          customerId: dbRecord?.customerId ?? null,
          createdAt: dbRecord?.createdAt ?? null,
          category: dbRecord?.category ?? decoded.category,
          dbRemark: dbRecord?.remark ?? null,
        };
      }),

    /** 激活密钥 */
    activate: publicProcedure
      .input(
        z.object({
          keyString: z.string().min(1),
          deviceInfo: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const decoded = decodeLicenseKey(input.keyString);
        if (!decoded.valid) {
          return { success: false, error: decoded.error || "密钥已过期" };
        }
        return activateLicenseKey(input.keyString.trim(), input.deviceInfo);
      }),

    /** 密钥统计 */
    stats: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getKeyStats(userIds);
    }),

    /** 导出密钥数据 */
    export: protectedProcedure
      .input(
        z.object({
          format: z.enum(["csv", "json"]),
          category: z.string().optional(),
          sensorType: z.string().optional(),
          isActivated: z.boolean().optional(),
          customerId: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        const { items } = await getLicenseKeys({
          userIds,
          page: 1,
          pageSize: 10000,
          category: input.category,
          sensorType: input.sensorType,
          isActivated: input.isActivated,
          customerId: input.customerId,
        });

        const sensorMap = SENSOR_LABEL_MAP;

        if (input.format === "json") {
          return items.map((k) => ({
            密钥: k.keyString,
            传感器类型: k.sensorType.split(",").map((v: string) => sensorMap[v] || v).join(", "),
            密钥类型: k.category === "production" ? "量产密钥" : "在线租赁密钥",
            有效期天数: k.days,
            到期时间: new Date(k.expireTimestamp).toLocaleString("zh-CN"),
            是否已激活: k.isActivated ? "是" : "否",
            激活时间: k.activatedAt ? new Date(k.activatedAt).toLocaleString("zh-CN") : "",
            客户: k.customerName || "",
            创建者: k.createdByName || "",
            创建时间: k.createdAt.toLocaleString("zh-CN"),
            备注: k.remark || "",
          }));
        }

        const header = "密钥,传感器类型,密钥类型,有效期天数,到期时间,是否已激活,激活时间,客户,创建者,创建时间,备注";
        const rows = items.map((k) =>
          [
            k.keyString,
            k.sensorType.split(",").map((v: string) => sensorMap[v] || v).join("/"),
            k.category === "production" ? "量产密钥" : "在线租赁密钥",
            k.days,
            new Date(k.expireTimestamp).toLocaleString("zh-CN"),
            k.isActivated ? "是" : "否",
            k.activatedAt ? new Date(k.activatedAt).toLocaleString("zh-CN") : "",
            k.customerName || "",
            k.createdByName || "",
            k.createdAt.toLocaleString("zh-CN"),
            k.remark || "",
          ].join(",")
        );
        return header + "\n" + rows.join("\n");
      }),
  }),
});

export type AppRouter = typeof appRouter;
