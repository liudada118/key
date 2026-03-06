import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router, superAdminProcedure } from "./_core/trpc";
import {
  activateLicenseKey,
  createAccount,
  getAllUsers,
  getKeyStats,
  getLicenseKeyByString,
  getLicenseKeys,
  getSubordinateUsers,
  getUserAndSubordinateIds,
  getUserById,
  insertLicenseKey,
  insertLicenseKeys,
  updateAccount,
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
    /** 获取下级账号列表 */
    list: protectedProcedure.query(async ({ ctx }) => {
      return getSubordinateUsers(ctx.user.id, ctx.user.role);
    }),

    /** 获取所有用户（超级管理员） */
    all: superAdminProcedure.query(async () => {
      return getAllUsers();
    }),

    /** 创建账号 */
    create: adminProcedure
      .input(
        z.object({
          name: z.string().min(1, "名称不能为空"),
          role: z.enum(["admin", "user"]),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 超级管理员可创建 admin 和 user，管理员只能创建 user
        if (ctx.user.role === "admin" && input.role === "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "管理员只能创建子账号",
          });
        }
        return createAccount({
          name: input.name,
          role: input.role,
          createdById: ctx.user.id,
          remark: input.remark,
        });
      }),

    /** 更新账号 */
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

        // 权限检查：只能管理自己创建的或下级
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

  // ===== 密钥管理 =====
  keys: router({
    /** 获取传感器类型列表（平铺） */
    sensorTypes: publicProcedure.query(() => SENSOR_TYPES),

    /** 获取传感器类型分组列表 */
    sensorGroups: publicProcedure.query(() => SENSOR_GROUPS),

    /** 获取密钥类型列表 */
    categories: publicProcedure.query(() => KEY_CATEGORIES),

    /** 生成单个密钥（支持多选传感器类型） */
    generate: protectedProcedure
      .input(
        z.object({
          sensorTypes: z.union([z.string(), z.array(z.string())]),
          days: z.number().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const keyString = generateLicenseKey(input.sensorTypes, input.days, input.category);
        const expireTimestamp = Date.now() + input.days * 24 * 60 * 60 * 1000;

        // 存储时将多选类型序列化为逗号分隔字符串
        const sensorTypeStr = Array.isArray(input.sensorTypes)
          ? input.sensorTypes.join(",")
          : input.sensorTypes;

        await insertLicenseKey({
          keyString,
          sensorType: sensorTypeStr,
          category: input.category,
          days: input.days,
          expireTimestamp,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || "未知",
          remark: input.remark || null,
        });

        return { keyString, expireTimestamp };
      }),

    /** 批量生成密钥（支持多选传感器类型） */
    batchGenerate: protectedProcedure
      .input(
        z.object({
          sensorTypes: z.union([z.string(), z.array(z.string())]),
          days: z.number().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          count: z.number().min(1).max(500),
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
        });
      }),

    /** 解密验证密钥 */
    verify: publicProcedure
      .input(z.object({ keyString: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const decoded = decodeLicenseKey(input.keyString);
        // 查数据库获取更多信息
        const dbRecord = await getLicenseKeyByString(input.keyString.trim());
        return {
          ...decoded,
          isActivated: dbRecord?.isActivated ?? false,
          activatedAt: dbRecord?.activatedAt ?? null,
          createdByName: dbRecord?.createdByName ?? null,
          createdAt: dbRecord?.createdAt ?? null,
          category: dbRecord?.category ?? decoded.category,
          dbRemark: dbRecord?.remark ?? null,
        };
      }),

    /** 激活密钥（每个密钥只能激活一次） */
    activate: publicProcedure
      .input(
        z.object({
          keyString: z.string().min(1),
          deviceInfo: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        // 先解密验证密钥是否有效
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
            创建者: k.createdByName || "",
            创建时间: k.createdAt.toLocaleString("zh-CN"),
            备注: k.remark || "",
          }));
        }

        // CSV format
        const header = "密钥,传感器类型,密钥类型,有效期天数,到期时间,是否已激活,激活时间,创建者,创建时间,备注";
        const rows = items.map((k) =>
          [
            k.keyString,
            k.sensorType.split(",").map((v: string) => sensorMap[v] || v).join("/"),
            k.category === "production" ? "量产密钥" : "在线租赁密钥",
            k.days,
            new Date(k.expireTimestamp).toLocaleString("zh-CN"),
            k.isActivated ? "是" : "否",
            k.activatedAt ? new Date(k.activatedAt).toLocaleString("zh-CN") : "",
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
