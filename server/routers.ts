import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router, superAdminProcedure } from "./_core/trpc";
import {
  activateLicenseKey,
  changePassword,
  createAccount,
  createCustomer,
  getAllCustomers,
  getAllUsers,
  getCustomerById,
  getCustomerKeyCount,
  getCustomers,
  getKeyStats,
  getLicenseKeyById,
  getLicenseKeyByString,
  getLicenseKeys,
  getSubordinateUsers,
  getUserAndSubordinateIds,
  updateLicenseKeyCategory,
  getUserById,
  getUserByUsername,
  insertLicenseKey,
  insertLicenseKeys,
  resetPassword,
  updateAccount,
  updateCustomer,
  verifyUserCredentials,
  getSensorTypesGrouped,
  getAllSensorTypes,
  addSensorType,
  deleteSensorType,
  restoreSensorType,
  updateSensorType,
  getSensorGroups,
} from "./db";
import {
  decodeLicenseKey,
  generateLicenseKey,
  KEY_CATEGORIES,
  type KeyCategory,
} from "@shared/crypto";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => {
      if (!opts.ctx.user) return null;
      // 不返回密码字段
      const { password, ...safeUser } = opts.ctx.user;
      return safeUser;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    /** 修改自己的密码 */
    changePassword: protectedProcedure
      .input(
        z.object({
          oldPassword: z.string().min(1, "旧密码不能为空"),
          newPassword: z.string().min(6, "新密码至少6位"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 验证旧密码
        const user = await verifyUserCredentials(ctx.user.username, input.oldPassword);
        if (!user) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "旧密码错误" });
        }
        await changePassword(ctx.user.id, input.newPassword);
        return { success: true };
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
          username: z.string().min(2, "用户名至少2个字符").max(32),
          password: z.string().min(6, "密码至少6位"),
          name: z.string().min(1, "名称不能为空"),
          role: z.enum(["admin", "user"]),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role === "admin" && input.role === "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "管理员只能创建子账号" });
        }
        // 检查用户名是否已存在
        const existing = await getUserByUsername(input.username);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "用户名已存在" });
        }
        return createAccount({
          username: input.username,
          password: input.password,
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

    /** 重置下级账号密码（管理员操作） */
    resetPassword: adminProcedure
      .input(
        z.object({
          id: z.number(),
          newPassword: z.string().min(6, "密码至少6位"),
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

        await resetPassword(input.id, input.newPassword);
        return { success: true };
      }),
  }),

  // ===== 客户管理 =====
  customers: router({
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

    all: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getAllCustomers(userIds);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const customer = await getCustomerById(input.id);
        if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });
        const keyCount = await getCustomerKeyCount(input.id);
        return { ...customer, keyCount };
      }),

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

  // ===== 传感器类型管理 =====
  sensors: router({
    /** 获取分组传感器类型（仅启用的） */
    groups: publicProcedure.query(async () => {
      return getSensorTypesGrouped();
    }),

    /** 获取所有传感器类型（包括禁用的，管理用） */
    all: superAdminProcedure.query(async () => {
      return getAllSensorTypes();
    }),

    /** 获取所有分组名称 */
    groupNames: publicProcedure.query(async () => {
      return getSensorGroups();
    }),

    /** 添加传感器类型 */
    add: superAdminProcedure
      .input(
        z.object({
          label: z.string().min(1, "名称不能为空"),
          value: z.string().min(1, "标识符不能为空").regex(/^[a-zA-Z0-9_]+$/, "标识符只能包含英文、数字和下划线"),
          groupName: z.string().min(1, "分组名不能为空"),
          groupIcon: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return addSensorType(input);
      }),

    /** 删除传感器类型（软删除） */
    delete: superAdminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteSensorType(input.id);
        return { success: true };
      }),

    /** 恢复传感器类型 */
    restore: superAdminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await restoreSensorType(input.id);
        return { success: true };
      }),

    /** 更新传感器类型 */
    update: superAdminProcedure
      .input(
        z.object({
          id: z.number(),
          label: z.string().optional(),
          groupName: z.string().optional(),
          groupIcon: z.string().optional(),
          sortOrder: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateSensorType(id, data);
      }),
  }),

  // ===== 密钥管理 =====
  keys: router({
    categories: publicProcedure.query(() => KEY_CATEGORIES),

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

    stats: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getKeyStats(userIds);
    }),

    /** 超级管理员更改密钥类型 */
    changeCategory: superAdminProcedure
      .input(
        z.object({
          keyId: z.number(),
          category: z.enum(["production", "rental"]),
        })
      )
      .mutation(async ({ input }) => {
        const key = await getLicenseKeyById(input.keyId);
        if (!key) {
          throw new TRPCError({ code: "NOT_FOUND", message: "密钥不存在" });
        }
        if (key.category === input.category) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "密钥类型未变更" });
        }
        const updated = await updateLicenseKeyCategory(input.keyId, input.category);
        return { success: true, key: updated };
      }),

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

        // 从数据库动态获取传感器标签映射
        const groups = await getSensorTypesGrouped();
        const sensorMap: Record<string, string> = {};
        for (const g of groups) {
          for (const item of g.items) {
            sensorMap[item.value] = item.label;
          }
        }

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
