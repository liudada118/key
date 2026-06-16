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
  createAuditLog,
  createCustomer,
  getAuditLogs,
  getAllCustomers,
  getAllUsers,
  getCustomerById,
  getCustomerKeyCount,
  getCustomers,
  getKeyDeviceCount,
  getKeyDevices,
  getKeyStats,
  getKeyStatusHistoryList,
  getLicenseKeyById,
  getLicenseKeyByString,
  getLicenseKeys,
  getSubordinateUsers,
  getUserAndSubordinateIds,
  maskKeyString,
  renewLicenseKey,
  restoreLicenseKey,
  revokeLicenseKey,
  suspendLicenseKey,
  unbindKeyDevice,
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
  ensureRsaKeyPair,
  getActiveRsaKeyPair,
  getAllRsaKeyPairs,
  generateAndStoreRsaKeyPair,
  generateOfflineActivationCode,
  getOfflineKeys,
  getOfflineKeyStats,
  recordHeartbeat,
  getKeyHeartbeats,
  getLostHeartbeatDevices,
  addToBlacklist,
  removeFromBlacklist,
  getBlacklist,
  isInBlacklist,
  exportBlacklistForClient,
  createContract,
  updateContract,
  getContracts,
  getContractById,
  getContractByNo,
  incrementContractUsedKeys,
  createTeam,
  updateTeam,
  getTeams,
  getTeamMembers,
  setUserTeam,
  createAlertRule,
  getAlertRules,
  updateAlertRule,
  createAlert,
  getAlerts,
  markAlertRead,
  resolveAlert,
  getUnreadAlertCount,
  scanExpiringKeys,
  scanExpiringContracts,
  createApproval,
  approveApproval,
  rejectApproval,
  getApprovals,
  getPendingApprovalCount,
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

  // ===== 离线密钥管理 =====
  offlineKeys: router({
    /** 生成离线激活码 */
    generate: protectedProcedure
      .input(
        z.object({
          machineId: z.string().length(16, "机器码必须为16位"),
          sensorTypes: z.union([z.literal("all"), z.array(z.string().min(1))]),
          days: z.number().min(1).max(36500),
          customerId: z.number().optional(),
          customerName: z.string().optional(),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        let customerName = input.customerName || null;
        if (input.customerId && !customerName) {
          const customer = await getCustomerById(input.customerId);
          customerName = customer?.name || null;
        }
        return generateOfflineActivationCode({
          machineId: input.machineId.toUpperCase(),
          sensorTypes: input.sensorTypes,
          days: input.days,
          customerId: input.customerId || null,
          customerName,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || "未知",
          remark: input.remark || null,
        });
      }),

    /** 离线密钥列表 */
    list: protectedProcedure
      .input(
        z.object({
          page: z.number().min(1).default(1),
          pageSize: z.number().min(1).max(100).default(20),
          search: z.string().optional(),
          machineId: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        return getOfflineKeys({
          userIds,
          page: input.page,
          pageSize: input.pageSize,
          search: input.search,
          machineId: input.machineId,
        });
      }),

    /** 离线密钥统计 */
    stats: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getOfflineKeyStats(userIds);
    }),

    /** 获取公钥（供客户端下载） */
    publicKey: publicProcedure.query(async () => {
      const keyPair = await getActiveRsaKeyPair();
      if (!keyPair) return null;
      return { publicKey: keyPair.publicKey, keySize: keyPair.keySize, name: keyPair.name };
    }),

    /** RSA 密钥对管理（超级管理员） */
    rsaKeyPairs: superAdminProcedure.query(async () => {
      return getAllRsaKeyPairs();
    }),

    /** 生成新的 RSA 密钥对（超级管理员） */
    generateRsaKeyPair: superAdminProcedure
      .input(
        z.object({
          name: z.string().min(1, "名称不能为空").default("default"),
          keySize: z.number().min(2048).max(4096).default(2048),
        })
      )
      .mutation(async ({ input }) => {
        const keyPair = await generateAndStoreRsaKeyPair(input.name, input.keySize);
        return { id: keyPair.id, name: keyPair.name, keySize: keyPair.keySize, publicKey: keyPair.publicKey };
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
          maxDevices: z.number().min(0).max(9999).default(1),
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
          maxDevices: input.maxDevices,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || "未知",
          customerId: input.customerId || null,
          customerName,
          remark: input.remark || null,
        });

        return { keyString, expireTimestamp, maxDevices: input.maxDevices };
      }),

    batchGenerate: protectedProcedure
      .input(
        z.object({
          sensorTypes: z.union([z.string(), z.array(z.string())]),
          days: z.number().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          count: z.number().min(1).max(500),
          maxDevices: z.number().min(0).max(9999).default(1),
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
            maxDevices: input.maxDevices,
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
          status: z.string().optional(),
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
          status: input.status,
          search: input.search,
          customerId: input.customerId,
        });
      }),

    verify: publicProcedure
      .input(z.object({
        keyString: z.string().min(1),
        deviceCode: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const decoded = decodeLicenseKey(input.keyString);
        const dbRecord = await getLicenseKeyByString(input.keyString.trim());

        // 获取设备绑定信息
        let devices: Awaited<ReturnType<typeof getKeyDevices>> = [];
        let deviceCount = 0;
        let deviceBound = false;
        if (dbRecord) {
          devices = await getKeyDevices(dbRecord.id);
          deviceCount = devices.length;
          if (input.deviceCode) {
            deviceBound = devices.some(d => d.deviceCode === input.deviceCode!.trim());
          }
        }

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
          maxDevices: dbRecord?.maxDevices ?? 1,
          deviceCount,
          devices,
          deviceBound,
        };
      }),

    /** 客户端统一接口：激活绑定 + 验证 + 返回授权信息 */
    activate: publicProcedure
      .input(
        z.object({
          keyString: z.string().min(1),
          deviceCode: z.string().min(1, "设备码不能为空"),
          deviceName: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 1. 解密密钥获取授权信息
        const decoded = decodeLicenseKey(input.keyString);
        if (!decoded.valid) {
          return {
            success: false,
            error: decoded.error || "密钥无效或已过期",
            // 仍然返回部分信息方便客户端展示
            sensorType: decoded.sensorType || null,
            sensorTypes: decoded.sensorTypes || [],
            isAllTypes: decoded.isAllTypes || false,
            expireDate: decoded.expireDate || null,
            remainingDays: decoded.remainingDays || 0,
            category: decoded.category || null,
          };
        }

        // 2. 获取客户端 IP
        const clientIp = ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || undefined;

        // 3. 尝试激活绑定
        const activateResult = await activateLicenseKey(input.keyString.trim(), input.deviceCode, input.deviceName, clientIp);

        // 4. 无论绑定成功还是失败，都返回完整的授权信息
        return {
          ...activateResult,
          // 授权信息
          sensorType: decoded.sensorType || null,
          sensorTypes: decoded.sensorTypes || [],
          isAllTypes: decoded.isAllTypes || false,
          expireDate: decoded.expireDate || null,
          expireTimestamp: decoded.expireTimestamp || null,
          remainingDays: decoded.remainingDays || 0,
          category: decoded.category || null,
        };
      }),

    /** 获取密钥的已绑定设备列表 */
    devices: protectedProcedure
      .input(z.object({ keyId: z.number() }))
      .query(async ({ input }) => {
        return getKeyDevices(input.keyId);
      }),

    /** 解绑设备（管理员操作） */
    unbindDevice: adminProcedure
      .input(z.object({
        keyId: z.number(),
        deviceId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return unbindKeyDevice(input.keyId, input.deviceId);
      }),

    // verifyOnDevice 已合并到 activate 接口中

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

        // 记录导出审计日志
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "EXPORT",
          resourceType: "licenseKey",
          description: `导出 ${items.length} 条密钥记录（${input.format} 格式）`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });

        if (input.format === "json") {
          return items.map((k) => ({
            密钥: k.keyString,
            传感器类型: k.sensorType.split(",").map((v: string) => sensorMap[v] || v).join(", "),
            密钥类型: k.category === "production" ? "量产密钥" : "在线租赁密钥",
            有效期天数: k.days,
            到期时间: new Date(k.expireTimestamp).toLocaleString("zh-CN"),
            状态: k.status,
            是否已激活: k.isActivated ? "是" : "否",
            激活时间: k.activatedAt ? new Date(k.activatedAt).toLocaleString("zh-CN") : "",
            客户: k.customerName || "",
            创建者: k.createdByName || "",
            创建时间: k.createdAt.toLocaleString("zh-CN"),
            备注: k.remark || "",
          }));
        }

        const header = "密钥,传感器类型,密钥类型,有效期天数,到期时间,状态,是否已激活,激活时间,客户,创建者,创建时间,备注";
        const rows = items.map((k) =>
          [
            k.keyString,
            k.sensorType.split(",").map((v: string) => sensorMap[v] || v).join("/"),
            k.category === "production" ? "量产密钥" : "在线租赁密钥",
            k.days,
            new Date(k.expireTimestamp).toLocaleString("zh-CN"),
            k.status,
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

    // ===== 密钥生命周期管理 =====

    /** 暂停密钥 */
    suspend: adminProcedure
      .input(z.object({
        keyId: z.number(),
        reason: z.string().min(1, "暂停原因不能为空"),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await suspendLicenseKey(input.keyId, input.reason, ctx.user.id, ctx.user.name || ctx.user.username);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "SUSPEND",
          resourceType: "licenseKey",
          resourceId: input.keyId,
          description: `暂停密钥 #${input.keyId}，原因: ${input.reason}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, key: result };
      }),

    /** 恢复密钥（从暂停状态） */
    restore: adminProcedure
      .input(z.object({
        keyId: z.number(),
        reason: z.string().min(1, "恢复原因不能为空"),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await restoreLicenseKey(input.keyId, input.reason, ctx.user.id, ctx.user.name || ctx.user.username);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "RESTORE",
          resourceType: "licenseKey",
          resourceId: input.keyId,
          description: `恢复密钥 #${input.keyId}，原因: ${input.reason}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, key: result };
      }),

    /** 吊销密钥（永久作废） */
    revoke: adminProcedure
      .input(z.object({
        keyId: z.number(),
        reason: z.string().min(1, "吊销原因不能为空"),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await revokeLicenseKey(input.keyId, input.reason, ctx.user.id, ctx.user.name || ctx.user.username);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "REVOKE",
          resourceType: "licenseKey",
          resourceId: input.keyId,
          description: `吊销密钥 #${input.keyId}，原因: ${input.reason}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, key: result };
      }),

    /** 续期密钥 */
    renew: adminProcedure
      .input(z.object({
        keyId: z.number(),
        additionalDays: z.number().min(1).max(36500),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await renewLicenseKey(input.keyId, input.additionalDays, ctx.user.id, ctx.user.name || ctx.user.username);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "RENEW",
          resourceType: "licenseKey",
          resourceId: input.keyId,
          description: `续期密钥 #${input.keyId}，增加 ${input.additionalDays} 天`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, key: result };
      }),

    /** 获取密钥状态变更历史 */
    statusHistory: protectedProcedure
      .input(z.object({
        keyId: z.number(),
        keyType: z.enum(["online", "offline"]).default("online"),
      }))
      .query(async ({ input }) => {
        return getKeyStatusHistoryList(input.keyType, input.keyId);
      }),
  }),

  // ===== 审计日志 =====
  audit: router({
    list: superAdminProcedure
      .input(
        z.object({
          page: z.number().min(1).default(1),
          pageSize: z.number().min(1).max(100).default(20),
          userId: z.number().optional(),
          action: z.string().optional(),
          resourceType: z.string().optional(),
          search: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        return getAuditLogs({
          page: input.page,
          pageSize: input.pageSize,
          userId: input.userId,
          action: input.action,
          resourceType: input.resourceType,
          search: input.search,
        });
      }),
  }),

  // ===== 心跳校验 =====
  heartbeat: router({
    /** 客户端心跳上报（公开接口，客户端定期调用） */
    ping: publicProcedure
      .input(z.object({
        keyString: z.string().min(1),
        deviceCode: z.string().min(1),
        clientVersion: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 通过 keyString 找到密钥
        const key = await getLicenseKeyByString(input.keyString);
        if (!key) {
          throw new TRPCError({ code: "NOT_FOUND", message: "密钥不存在" });
        }
        // 检查密钥状态
        if (key.status === "SUSPENDED") {
          return { authorized: false, reason: "KEY_SUSPENDED", message: "密钥已被暂停" };
        }
        if (key.status === "REVOKED") {
          return { authorized: false, reason: "KEY_REVOKED", message: "密钥已被吊销" };
        }
        if (key.expireTimestamp < Date.now()) {
          return { authorized: false, reason: "KEY_EXPIRED", message: "密钥已过期" };
        }
        // 记录心跳
        const clientIp = ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || undefined;
        await recordHeartbeat({
          keyId: key.id,
          keyType: "online",
          deviceCode: input.deviceCode,
          clientIp,
          clientVersion: input.clientVersion,
        });
        return {
          authorized: true,
          status: key.status,
          expireTimestamp: key.expireTimestamp,
          remainingDays: Math.max(0, Math.ceil((key.expireTimestamp - Date.now()) / (1000 * 60 * 60 * 24))),
          sensorType: key.sensorType,
        };
      }),

    /** 查看密钥心跳记录（管理端） */
    list: adminProcedure
      .input(z.object({
        keyId: z.number(),
        keyType: z.enum(["online", "offline"]).default("online"),
      }))
      .query(async ({ input }) => {
        return getKeyHeartbeats(input.keyId, input.keyType);
      }),

    /** 获取心跳丢失设备 */
    lost: adminProcedure
      .input(z.object({
        hoursThreshold: z.number().default(48),
      }))
      .query(async ({ input }) => {
        return getLostHeartbeatDevices(input.hoursThreshold);
      }),
  }),

  // ===== 离线黑名单 =====
  blacklist: router({
    /** 获取黑名单列表 */
    list: adminProcedure.query(async () => {
      return getBlacklist();
    }),

    /** 添加到黑名单 */
    add: adminProcedure
      .input(z.object({
        machineId: z.string().min(1),
        offlineKeyId: z.number().optional(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await addToBlacklist({
          machineId: input.machineId,
          offlineKeyId: input.offlineKeyId,
          reason: input.reason,
          addedById: ctx.user.id,
          addedByName: ctx.user.name || ctx.user.username,
        });
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "CREATE",
          resourceType: "blacklist",
          description: `添加机器码 ${input.machineId} 到黑名单`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, item: result };
      }),

    /** 从黑名单移除 */
    remove: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await removeFromBlacklist(input.id);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "DELETE",
          resourceType: "blacklist",
          resourceId: input.id,
          description: `从黑名单移除记录 #${input.id}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true };
      }),

    /** 检查机器码是否在黑名单（公开接口，供客户端调用） */
    check: publicProcedure
      .input(z.object({ machineId: z.string().min(1) }))
      .query(async ({ input }) => {
        const blocked = await isInBlacklist(input.machineId);
        return { blocked };
      }),

    /** 导出黑名单文件（供客户端导入） */
    export: adminProcedure.query(async () => {
      return exportBlacklistForClient();
    }),
  }),

  // ===== 合同管理 =====
  contracts: router({
    /** 获取合同列表 */
    list: protectedProcedure
      .input(z.object({
        customerId: z.number().optional(),
        status: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      }))
      .query(async ({ input }) => {
        return getContracts(input);
      }),

    /** 获取单个合同 */
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getContractById(input.id);
      }),

    /** 创建合同 */
    create: adminProcedure
      .input(z.object({
        contractNo: z.string().min(1, "合同编号不能为空"),
        title: z.string().min(1, "合同标题不能为空"),
        customerId: z.number().optional(),
        customerName: z.string().optional(),
        signDate: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        totalKeys: z.number().min(0).optional(),
        remark: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 检查合同编号唯一性
        const existing = await getContractByNo(input.contractNo);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "合同编号已存在" });
        }
        const result = await createContract({
          ...input,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || ctx.user.username,
        });
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "CREATE",
          resourceType: "contract",
          resourceId: result?.id,
          description: `创建合同 ${input.contractNo}: ${input.title}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, contract: result };
      }),

    /** 更新合同 */
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        customerId: z.number().nullable().optional(),
        customerName: z.string().nullable().optional(),
        signDate: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        totalKeys: z.number().optional(),
        status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).optional(),
        remark: z.string().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateContract(id, data);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "UPDATE",
          resourceType: "contract",
          resourceId: id,
          description: `更新合同 #${id}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true };
      }),
  }),

  // ===== 团队管理 =====
  teams: router({
    /** 获取所有团队 */
    list: protectedProcedure.query(async () => {
      return getTeams();
    }),

    /** 获取团队成员 */
    members: adminProcedure
      .input(z.object({ teamId: z.number() }))
      .query(async ({ input }) => {
        return getTeamMembers(input.teamId);
      }),

    /** 创建团队 */
    create: superAdminProcedure
      .input(z.object({
        name: z.string().min(1, "团队名称不能为空"),
        description: z.string().optional(),
        leaderId: z.number().optional(),
        leaderName: z.string().optional(),
        parentTeamId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await createTeam(input);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "CREATE",
          resourceType: "team",
          resourceId: result?.id,
          description: `创建团队: ${input.name}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, team: result };
      }),

    /** 更新团队 */
    update: superAdminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        leaderId: z.number().nullable().optional(),
        leaderName: z.string().nullable().optional(),
        parentTeamId: z.number().nullable().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateTeam(id, data);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "UPDATE",
          resourceType: "team",
          resourceId: id,
          description: `更新团队 #${id}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true };
      }),

    /** 设置用户所属团队 */
    setMember: superAdminProcedure
      .input(z.object({
        userId: z.number(),
        teamId: z.number().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        await setUserTeam(input.userId, input.teamId);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "UPDATE",
          resourceType: "user",
          resourceId: input.userId,
          description: `设置用户 #${input.userId} 所属团队为 ${input.teamId || '无'}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true };
      }),
  }),

  // ===== 告警管理 =====
  alerts: router({
    /** 获取告警列表 */
    list: adminProcedure
      .input(z.object({
        unreadOnly: z.boolean().optional(),
        unresolvedOnly: z.boolean().optional(),
        type: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      }))
      .query(async ({ input }) => {
        return getAlerts(input);
      }),

    /** 获取未读告警数量 */
    unreadCount: protectedProcedure.query(async () => {
      return getUnreadAlertCount();
    }),

    /** 标记已读 */
    markRead: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await markAlertRead(input.id);
        return { success: true };
      }),

    /** 处理告警 */
    resolve: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await resolveAlert(input.id, ctx.user.id);
        return { success: true };
      }),

    /** 手动触发到期扫描 */
    scanExpiring: superAdminProcedure
      .input(z.object({ daysBeforeExpiry: z.number().default(7) }))
      .mutation(async ({ input }) => {
        const expiringKeys = await scanExpiringKeys(input.daysBeforeExpiry);
        const expiringContracts = await scanExpiringContracts(30);
        // 为每个即将到期的密钥创建告警
        for (const key of expiringKeys) {
          const remainDays = Math.ceil((key.expireTimestamp - Date.now()) / (1000 * 60 * 60 * 24));
          await createAlert({
            type: "EXPIRY_WARNING",
            level: remainDays <= 3 ? "CRITICAL" : "WARNING",
            title: `密钥 #${key.id} 即将在 ${remainDays} 天后到期`,
            content: `客户: ${key.customerName || '未关联'}，传感器: ${key.sensorType}`,
            resourceType: "licenseKey",
            resourceId: key.id,
          });
        }
        // 为即将到期的合同创建告警
        for (const contract of expiringContracts) {
          await createAlert({
            type: "CONTRACT_EXPIRY",
            level: "WARNING",
            title: `合同 ${contract.contractNo} 即将到期`,
            content: `合同: ${contract.title}，客户: ${contract.customerName || '未关联'}`,
            resourceType: "contract",
            resourceId: contract.id,
          });
        }
        return {
          success: true,
          expiringKeysCount: expiringKeys.length,
          expiringContractsCount: expiringContracts.length,
        };
      }),

    /** 告警规则列表 */
    rules: superAdminProcedure.query(async () => {
      return getAlertRules(false);
    }),

    /** 创建告警规则 */
    createRule: superAdminProcedure
      .input(z.object({
        name: z.string().min(1),
        type: z.enum(["EXPIRY_WARNING", "HEARTBEAT_LOST", "QUOTA_EXCEEDED", "CONTRACT_EXPIRY"]),
        config: z.object({
          daysBeforeExpiry: z.number().optional(),
          hoursThreshold: z.number().optional(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await createAlertRule({
          name: input.name,
          type: input.type,
          config: input.config,
          createdById: ctx.user.id,
        });
        return { success: true, rule: result };
      }),

    /** 更新告警规则 */
    updateRule: superAdminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        config: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateAlertRule(id, data);
        return { success: true };
      }),
  }),

  // ===== 审批流 =====
  approvals: router({
    /** 获取审批列表 */
    list: adminProcedure
      .input(z.object({
        status: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      }))
      .query(async ({ input }) => {
        return getApprovals(input);
      }),

    /** 获取待审批数量 */
    pendingCount: adminProcedure.query(async () => {
      return getPendingApprovalCount();
    }),

    /** 发起审批 */
    create: protectedProcedure
      .input(z.object({
        type: z.enum(["REVOKE", "BATCH_GENERATE", "DELETE", "SUSPEND"]),
        resourceType: z.string(),
        resourceId: z.number().optional(),
        requestData: z.any().optional(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await createApproval({
          type: input.type,
          requesterId: ctx.user.id,
          requesterName: ctx.user.name || ctx.user.username,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          requestData: input.requestData,
          reason: input.reason,
        });
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "CREATE",
          resourceType: "approval",
          resourceId: result?.id,
          description: `发起${input.type}审批，目标: ${input.resourceType} #${input.resourceId}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, approval: result };
      }),

    /** 审批通过 */
    approve: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await approveApproval(input.id, ctx.user.id, ctx.user.name || ctx.user.username);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "UPDATE",
          resourceType: "approval",
          resourceId: input.id,
          description: `审批通过 #${input.id}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true };
      }),

    /** 审批拒绝 */
    reject: adminProcedure
      .input(z.object({
        id: z.number(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await rejectApproval(input.id, ctx.user.id, ctx.user.name || ctx.user.username, input.reason);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "UPDATE",
          resourceType: "approval",
          resourceId: input.id,
          description: `审批拒绝 #${input.id}${input.reason ? '，原因: ' + input.reason : ''}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
