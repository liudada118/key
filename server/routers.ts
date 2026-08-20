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
  getKeyStats,
  getKeyStatusHistoryList,
  getLicenseKeyById,
  getLicenseKeyByString,
  getLicenseKeys,
  getSensorValuesByGroups,
  getManagedSensorGroups,
  getDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getSubordinateUsers,
  getUserAndSubordinateIds,
  maskKeyString,
  renewLicenseKey,
  restoreLicenseKey,
  revokeLicenseKey,
  deleteLicenseKeysVisible,
  suspendLicenseKey,
  updateLicenseKeyCategory,
  getUserById,
  getUserByUsername,
  insertLicenseKey,
  insertLicenseKeys,
  resetPassword,
  updateAccount,
  updateCustomer,
  deleteCustomer,
  getCustomerActiveKeyCount,
  deleteContract,
  getContractActiveKeyCount,
  deleteAccount,
  getAccountDependents,
  verifyUserCredentials,
  getSensorTypesGrouped,
  getAllSensorTypes,
  addSensorType,
  deleteSensorType,
  restoreSensorType,
  hardDeleteSensorType,
  updateSensorType,
  getSensorGroups,
  ensureRsaKeyPair,
  getActiveRsaKeyPair,
  getAllRsaKeyPairs,
  generateAndStoreRsaKeyPair,
  generateOfflineActivationCode,
  getOfflineKeys,
  getOfflineKeyStats,
  deleteOfflineKeysVisible,
  recordHeartbeat,
  getKeyHeartbeats,
  getLostHeartbeatDevices,
  createContract,
  updateContract,
  getContracts,
  getContractById,
  getContractByNo,
  incrementContractUsedKeys,
  createDeviceCodeRecord,
  getDeviceCodeRecords,
  getDeviceCodeRecordById,
  deleteDeviceCodeRecord,
  getTamperedKeys,
  getTamperedKeyCount,
  clearKeyTamper,
  reissueLicenseKey,
  getFeedbackList,
  getFeedbackStats,
  isFeedbackInScope,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
  getGeneratedKeyCountsByContractNos,
  createKeyGenerationRequest,
  getKeyGenerationRequests,
} from "./db";
import {
  decodeLicenseKey,
  KEY_CATEGORIES,
  type KeyCategory,
} from "@shared/crypto";
import {
  getFeishuContracts,
  getFeishuContractSubmitterScope,
} from "./feishuContracts";
import { notifyFeishuKeyRequest } from "./feishuKeyRequestWebhook";
import { sendFeishuKeyRequestApprovalCard } from "./feishuKeyRequestCard";
import { reviewKeyGenerationRequest } from "./keyGenerationRequestApproval";
import { prepareOnlineKeyGeneration } from "./onlineKeyGeneration";
import { TRPCError } from "@trpc/server";
import {
  getLicenseGroupOptions,
  normalizeLicenseFile,
} from "@shared/licenseScopes";
import { getLicenseRegistryInfo } from "./licenseRegistry";

/**
 * 授权范围入参的公共校验：`"all"` / 单系统 key / 数组（元素可为 `@group:<groupKey>` 分类令牌）。
 * 未知分类、空范围一律 4xx 拒绝，绝不让非法范围走到 generateLicenseKey。
 * 四处签发入口（keys.generate / keys.batchGenerate / offlineKeys.generate /
 * keyGenerationRequests.create）共用这一份，避免复制成四份各自漂移。
 */
function licenseScopeSchema<T extends z.ZodTypeAny>(inner: T) {
  return inner.superRefine((value, ctx) => {
    try {
      normalizeLicenseFile(value as string | string[]);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `授权范围无效：${(error as Error).message}`,
      });
    }
  });
}

async function getAccessibleFeishuContract(
  user: { role: string; name?: string | null },
  contractId?: number,
  contractNo?: string
) {
  const hasContractId = typeof contractId === "number";
  const trimmedContractNo = contractNo?.trim();
  const hasContractNo = Boolean(trimmedContractNo);
  if (!hasContractId && !hasContractNo && user.role === "super_admin") {
    return null;
  }
  if (!hasContractId || !hasContractNo) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "生成密钥必须绑定合同；无合同请提交超级管理员审批",
    });
  }

  const submitterScope = getFeishuContractSubmitterScope(user);
  if (submitterScope === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前子账号未设置姓名，无法匹配可用合同",
    });
  }

  const result = await getFeishuContracts({
    status: "ACTIVE",
    ...(submitterScope ? { submitter: submitterScope } : {}),
    page: 1,
    pageSize: 10_000,
  });
  const contract = result.items.find(
    (item) =>
      item.id === contractId &&
      item.contractNo.trim().toLocaleLowerCase() ===
        trimmedContractNo!.toLocaleLowerCase()
  );
  if (!contract) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "合同不存在、未生效或不在当前账号可用范围内",
    });
  }
  return contract;
}

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
    list: protectedProcedure
      .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      }))
      .query(async ({ ctx, input }) => {
        return getSubordinateUsers(ctx.user.id, ctx.user.role, { page: input.page, pageSize: input.pageSize });
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
          departmentId: z.number().optional(),
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
        // 部门归属：管理员只能在本部门下建子账号；仅超管可指定其他部门。
        let departmentId = input.departmentId ?? null;
        let createdById = ctx.user.id;
        if (ctx.user.role === "admin") {
          departmentId = ctx.user.departmentId ?? null; // 强制本部门，忽略传入
        } else if (departmentId) {
          // 超管代建 → 挂到该部门管理员名下，归属正确
          const dept = await getDepartmentById(departmentId);
          if (dept?.managerId) createdById = dept.managerId;
        }
        return createAccount({
          username: input.username,
          password: input.password,
          name: input.name,
          role: input.role,
          createdById,
          remark: input.remark,
          departmentId,
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

    /** 修改自己的资料（名称/备注）——所有角色可用 */
    updateSelf: protectedProcedure
      .input(
        z.object({
          name: z.string().max(30).optional(),
          remark: z.string().max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return updateAccount(ctx.user.id, { name: input.name, remark: input.remark });
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

    /** 删除账号（硬删除，名下有关联数据则拦截） */
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const target = await getUserById(input.id);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });

        if (target.id === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除自己的账号" });
        }
        if (target.role === "super_admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权删除超级管理员" });
        }
        if (ctx.user.role === "admin" && target.createdById !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权操作此账号" });
        }

        const dep = await getAccountDependents(input.id);
        if (dep.total > 0) {
          const parts: string[] = [];
          if (dep.subordinates) parts.push(`${dep.subordinates} 个下级账号`);
          if (dep.onlineKeys) parts.push(`${dep.onlineKeys} 个在线密钥`);
          if (dep.offlineKeys) parts.push(`${dep.offlineKeys} 个离线密钥`);
          if (dep.customers) parts.push(`${dep.customers} 个客户`);
          if (dep.contracts) parts.push(`${dep.contracts} 个合同`);
          throw new TRPCError({
            code: "CONFLICT",
            message: `该账号名下还有 ${parts.join("、")}，无法删除`,
          });
        }

        await deleteAccount(input.id);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "DELETE",
          resourceType: "account",
          resourceId: input.id,
          description: `删除账号 ${target.username}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
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

    /** 删除客户（硬删除，名下有关联密钥则拦截） */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getCustomerById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });

        // 权限：管理员/子账号只能删自己创建的；超级管理员不限
        if (ctx.user.role !== "super_admin") {
          const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
          if (!userIds.includes(existing.createdById)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "无权删除此客户" });
          }
        }

        // 存在未吊销的关联密钥时拦截，需先吊销密钥
        const activeKeyCount = await getCustomerActiveKeyCount(input.id);
        if (activeKeyCount > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "当前客户存在关联密钥！请先吊销密钥后再删除客户。",
          });
        }

        // 删除客户：自动解除已吊销密钥的客户归属（密钥仍保留，归属显示 "-"）
        await deleteCustomer(input.id);
        return { success: true };
      }),
  }),

  // ===== 传感器类型管理 =====
  sensors: router({
    /** 获取分组传感器类型（仅启用的） */
    groups: publicProcedure.query(async () => {
      return getSensorTypesGrouped();
    }),

    /**
     * 授权分类清单（v3 分类授权）。后台「整个分类」勾选项用这个接口，
     * token 字段就是要塞进密钥的 `@group:<key>` 令牌。
     */
    licenseGroups: publicProcedure.query(() => {
      const registry = getLicenseRegistryInfo();
      return {
        groups: getLicenseGroupOptions(),
        registrySha256: registry.sha256,
        registrySource: registry.source,
      };
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

    /** 硬删除传感器类型（彻底删除该行） */
    hardDelete: superAdminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await hardDeleteSensorType(input.id);
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
          sensorTypes: licenseScopeSchema(
            z.union([z.literal("all"), z.array(z.string().min(1)).min(1)])
          ),
          days: z.number().int().min(1).max(36500),
          customerId: z.number().optional(),
          customerName: z.string().optional(),
          contractId: z.number().optional(),
          contractNo: z.string().optional(),
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
          sensorTypes: input.sensorTypes,
          days: input.days,
          customerId: input.customerId || null,
          customerName,
          contractId: input.contractId || null,
          contractNo: input.contractNo || null,
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

    /** 删除离线密钥（仅从列表移除；离线激活码无法服务端作废）——谁能看到谁能删 */
    batchDelete: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1, "请选择要删除的密钥") }))
      .mutation(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        const res = await deleteOfflineKeysVisible(input.ids, { userIds });
        if (res.deleted > 0) {
          await createAuditLog({
            userId: ctx.user.id,
            userName: ctx.user.name || ctx.user.username,
            action: "DELETE",
            resourceType: "offlineKey",
            resourceId: res.ids[0],
            description: `删除离线密钥 ${res.ids.length} 个：#${res.ids.join("、#")}`,
            ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
            userAgent: ctx.req?.headers?.['user-agent'] || null,
          });
        }
        return { success: true, deleted: res.deleted };
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
          sensorTypes: licenseScopeSchema(
            z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
          ),
          days: z.number().int().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          customerId: z.number().optional(),
          customerName: z.string().optional(),
          contractId: z.number().optional(),
          contractNo: z.string().trim().min(1, "合同编号不能为空").optional(),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const contract = await getAccessibleFeishuContract(
          ctx.user,
          input.contractId,
          input.contractNo
        );
        const prepared = prepareOnlineKeyGeneration({
          mode: "single",
          sensorTypes: input.sensorTypes,
          days: input.days,
          category: input.category,
          count: 1,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || "未知",
          customerName: contract?.customerName,
          contractId: contract?.id,
          contractNo: contract?.contractNo,
          remark: input.remark,
        });
        await insertLicenseKey(prepared.records[0]);
        const result = prepared.keys[0];
        if (!contract) {
          await createAuditLog({
            userId: ctx.user.id,
            userName: ctx.user.name || ctx.user.username,
            action: "CREATE",
            resourceType: "licenseKey",
            description: "超级管理员无合同直接生成 1 个在线密钥",
            ip: ctx.req?.headers?.["x-forwarded-for"] as string || ctx.req?.socket?.remoteAddress || null,
            userAgent: ctx.req?.headers?.["user-agent"] || null,
          });
        }

        return result;
      }),

    batchGenerate: protectedProcedure
      .input(
        z.object({
          sensorTypes: licenseScopeSchema(
            z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
          ),
          days: z.number().int().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          count: z.number().int().min(1).max(500),
          customerId: z.number().optional(),
          customerName: z.string().optional(),
          contractId: z.number().optional(),
          contractNo: z.string().trim().min(1, "合同编号不能为空").optional(),
          remark: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const contract = await getAccessibleFeishuContract(
          ctx.user,
          input.contractId,
          input.contractNo
        );
        const prepared = prepareOnlineKeyGeneration({
          mode: "batch",
          sensorTypes: input.sensorTypes,
          days: input.days,
          category: input.category,
          count: input.count,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || "未知",
          customerName: contract?.customerName,
          contractId: contract?.id,
          contractNo: contract?.contractNo,
          remark: input.remark,
        });
        await insertLicenseKeys(prepared.records);
        if (!contract) {
          await createAuditLog({
            userId: ctx.user.id,
            userName: ctx.user.name || ctx.user.username,
            action: "CREATE",
            resourceType: "licenseKey",
            description: `超级管理员无合同直接生成 ${prepared.keys.length} 个在线密钥`,
            ip: ctx.req?.headers?.["x-forwarded-for"] as string || ctx.req?.socket?.remoteAddress || null,
            userAgent: ctx.req?.headers?.["user-agent"] || null,
          });
        }
        return {
          batchId: prepared.batchId as string,
          keys: prepared.keys,
          count: prepared.keys.length,
        };
      }),

    list: protectedProcedure
      .input(
        z.object({
          page: z.number().min(1).default(1),
          pageSize: z.number().min(1).max(100).default(20),
          category: z.string().optional(),
          genType: z.enum(["single", "batch"]).optional(),
          sensorType: z.string().optional(),
          isActivated: z.boolean().optional(),
          status: z.string().optional(),
          search: z.string().optional(),
          customerId: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        // 部门管理员：密钥用到其“所管理部门的传感器分组” → 跨部门可见（超管的 userIds 已含全部，无需此项）
        const managedGroups = ctx.user.role !== "super_admin" ? await getManagedSensorGroups(ctx.user.id) : [];
        const visibleSensorValues = managedGroups.length ? await getSensorValuesByGroups(managedGroups) : [];
        return getLicenseKeys({
          userIds,
          page: input.page,
          pageSize: input.pageSize,
          category: input.category,
          genType: input.genType,
          sensorType: input.sensorType,
          isActivated: input.isActivated,
          status: input.status,
          search: input.search,
          customerId: input.customerId,
          visibleSensorValues,
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

        // 生命周期状态以数据库为权威：吊销/暂停/异常会覆盖"按到期时间算的有效性"
        const dbStatus = dbRecord?.status ?? (dbRecord ? "ISSUED" : "UNKNOWN");
        const now = Date.now();
        // 在线密钥到期以数据库 expireTimestamp 为权威（支持续期延长当前密钥）；无记录时退回密钥串日期
        const effectiveExpire = dbRecord ? dbRecord.expireTimestamp : (decoded.expireTimestamp ?? null);
        let valid = effectiveExpire != null ? now < effectiveExpire : decoded.valid;
        let statusReason: string | null = null;
        if (dbRecord) {
          if (dbStatus === "REVOKED") {
            valid = false;
            statusReason = dbRecord.revokeReason || "密钥已吊销";
          } else if (dbStatus === "SUSPENDED") {
            valid = false;
            statusReason = dbRecord.suspendReason || "密钥已暂停";
          } else if (dbStatus === "TAMPERED") {
            valid = false;
            statusReason = dbRecord.tamperReason || "密钥异常（检测到时间回拨/篡改）";
          }
        }

        const effectiveRemainingDays = effectiveExpire != null
          ? Math.ceil((effectiveExpire - now) / (1000 * 60 * 60 * 24))
          : (decoded.remainingDays ?? 0);

        return {
          ...decoded,
          valid,
          expireTimestamp: effectiveExpire,
          remainingDays: effectiveRemainingDays,
          expireDate: effectiveExpire != null ? new Date(effectiveExpire).toISOString() : (decoded.expireDate ?? null),
          status: dbStatus,
          statusReason,
          isActivated: dbRecord?.isActivated ?? false,
          activatedAt: dbRecord?.activatedAt ?? null,
          suspendedAt: dbRecord?.suspendedAt ?? null,
          revokedAt: dbRecord?.revokedAt ?? null,
          tamperedAt: dbRecord?.tamperedAt ?? null,
          revokeReason: dbRecord?.revokeReason ?? null,
          suspendReason: dbRecord?.suspendReason ?? null,
          tamperReason: dbRecord?.tamperReason ?? null,
          createdByName: dbRecord?.createdByName ?? null,
          customerName: dbRecord?.customerName ?? null,
          customerId: dbRecord?.customerId ?? null,
          createdAt: dbRecord?.createdAt ?? null,
          category: dbRecord?.category ?? decoded.category,
          dbRemark: dbRecord?.remark ?? null,
        };
      }),

    /** 客户端统一接口：验证 + 首次使用激活 + 返回授权信息 */
    activate: publicProcedure
      .input(
        z.object({
          keyString: z.string().min(1),
          deviceCode: z.string().optional(),
          deviceName: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 1. 解密密钥获取授权信息
        const decoded = decodeLicenseKey(input.keyString);
        // 仅当密钥串完全无法解密（连到期都解不出）才直接拒绝；
        // 能解密但“串里已过期”的情况交给数据库判定（支持续期延长当前密钥）
        if (!decoded.expireTimestamp) {
          return {
            success: false,
            error: decoded.error || "密钥无效",
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

        // 3. 尝试激活绑定（activateLicenseKey 内部已以数据库 expireTimestamp 判过期）
        let activateResult;
        try {
          activateResult = await activateLicenseKey(input.keyString.trim(), input.deviceCode, input.deviceName, clientIp);
        } catch (e) {
          // 数据库不可用时退回按密钥串自身到期判定（离线兜底）：串里已过期直接拒绝；串有效但 DB 异常则上抛
          if (!decoded.valid) {
            return {
              success: false,
              error: decoded.error || "密钥已过期",
              sensorType: decoded.sensorType || null,
              sensorTypes: decoded.sensorTypes || [],
              isAllTypes: decoded.isAllTypes || false,
              expireDate: decoded.expireDate || null,
              remainingDays: decoded.remainingDays ?? 0,
              category: decoded.category || null,
            };
          }
          throw e;
        }

        // 4. 激活失败（过期/吊销/暂停/超限）：保持与旧版完全一致的返回结构，
        //    剩余天数用密钥串解出的真实值（过期时为负，客户端据此判过期），不返回“看似有效”的载荷
        if (!activateResult.success) {
          return {
            ...activateResult,
            sensorType: decoded.sensorType || null,
            sensorTypes: decoded.sensorTypes || [],
            isAllTypes: decoded.isAllTypes || false,
            expireDate: decoded.expireDate || null,
            remainingDays: decoded.remainingDays ?? 0,
            category: decoded.category || null,
          };
        }

        // 5. 激活成功：到期以数据库为权威（支持续期延长当前密钥）
        const dbRec = await getLicenseKeyByString(input.keyString.trim());
        const now = Date.now();
        const effectiveExpire = dbRec ? dbRec.expireTimestamp : (decoded.expireTimestamp ?? null);
        const effectiveRemainingDays = effectiveExpire != null
          ? Math.max(0, Math.ceil((effectiveExpire - now) / (1000 * 60 * 60 * 24)))
          : 0;
        return {
          ...activateResult,
          // 授权信息
          sensorType: decoded.sensorType || null,
          sensorTypes: decoded.sensorTypes || [],
          isAllTypes: decoded.isAllTypes || false,
          expireDate: effectiveExpire != null ? new Date(effectiveExpire).toISOString() : (decoded.expireDate || null),
          expireTimestamp: effectiveExpire,
          remainingDays: effectiveRemainingDays,
          category: (dbRec?.category as string | null) || decoded.category || null,
        };
      }),

    stats: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      // 与密钥管理列表同口径：叠加部门管理员的跨部门可见（管理分组 + all）
      const managedGroups = ctx.user.role !== "super_admin" ? await getManagedSensorGroups(ctx.user.id) : [];
      const visibleSensorValues = managedGroups.length ? await getSensorValuesByGroups(managedGroups) : [];
      return getKeyStats(userIds, visibleSensorValues);
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
    suspend: protectedProcedure
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
    restore: protectedProcedure
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
    revoke: protectedProcedure
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

    /** 删除密钥（硬删除，单个或批量）——谁能看到谁就能删，只删可见范围内的 id */
    batchDelete: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1, "请选择要删除的密钥") }))
      .mutation(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        const managedGroups = ctx.user.role !== "super_admin" ? await getManagedSensorGroups(ctx.user.id) : [];
        const visibleSensorValues = managedGroups.length ? await getSensorValuesByGroups(managedGroups) : [];
        const res = await deleteLicenseKeysVisible(input.ids, {
          userIds,
          visibleSensorValues,
          actorId: ctx.user.id,
          actorName: ctx.user.name || ctx.user.username,
        });
        if (res.deleted > 0) {
          await createAuditLog({
            userId: ctx.user.id,
            userName: ctx.user.name || ctx.user.username,
            action: "DELETE",
            resourceType: "licenseKey",
            resourceId: res.ids[0],
            description: `删除密钥 ${res.ids.length} 个：#${res.ids.join("、#")}`,
            ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
            userAgent: ctx.req?.headers?.['user-agent'] || null,
          });
        }
        return { success: true, deleted: res.deleted };
      }),

    /** 续期密钥 */
    renew: protectedProcedure
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

    // ===== 异常密钥（TAMPERED）管理 =====

    /** 异常密钥列表（按数据域过滤） */
    tamperedList: adminProcedure
      .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      }))
      .query(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        return getTamperedKeys(userIds, { page: input.page, pageSize: input.pageSize });
      }),

    /** 异常密钥数量（监控/角标） */
    tamperedCount: protectedProcedure.query(async ({ ctx }) => {
      const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getTamperedKeyCount(userIds);
    }),

    /** 清除异常 / 重新激活 */
    clearTamper: adminProcedure
      .input(z.object({ keyId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const result = await clearKeyTamper(input.keyId, ctx.user.id, ctx.user.name || ctx.user.username);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "RESTORE",
          resourceType: "licenseKey",
          resourceId: input.keyId,
          description: `清除异常/重新激活密钥 #${input.keyId}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, key: result };
      }),

    /** 重新签发新密钥（默认吊销旧 key） */
    reissue: adminProcedure
      .input(z.object({ keyId: z.number(), revokeOld: z.boolean().default(true) }))
      .mutation(async ({ ctx, input }) => {
        const result = await reissueLicenseKey(input.keyId, ctx.user.id, ctx.user.name || ctx.user.username, { revokeOld: input.revokeOld });
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "CREATE",
          resourceType: "licenseKey",
          resourceId: result.newKey.id,
          description: `重新签发密钥 #${result.newKey.id}（源 #${result.oldKeyId}${input.revokeOld ? "，旧 key 已吊销" : ""}）`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true, ...result };
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
        if (key.status === "TAMPERED") {
          return { authorized: false, reason: "KEY_TAMPERED", message: key.tamperReason || "密钥异常：检测到时间回拨或篡改" };
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

  // ===== 无合同密钥生成申请 =====
  keyGenerationRequests: router({
    create: protectedProcedure
      .input(
        z.object({
          mode: z.enum(["single", "batch"]),
          sensorTypes: licenseScopeSchema(
            z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
          ),
          days: z.number().int().min(1).max(36500),
          category: z.enum(["production", "rental"]),
          count: z.number().int().min(1).max(500).optional(),
          reason: z.string().trim().min(2, "请填写无合同生成原因").max(1000),
          generationRemark: z.string().trim().max(1000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const count = input.mode === "batch" ? input.count || 1 : 1;
        const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const requestNo = `KGR-${datePart}-${nanoid(8).toUpperCase()}`;
        const requestedByName = ctx.user.name || ctx.user.username;
        const request = await createKeyGenerationRequest({
          requestNo,
          mode: input.mode,
          sensorTypes: JSON.stringify(input.sensorTypes),
          days: input.days,
          category: input.category,
          count,
          reason: input.reason,
          generationRemark: input.generationRemark || null,
          requestedById: ctx.user.id,
          requestedByName,
          status: "PENDING",
        });

        await createAuditLog({
          userId: ctx.user.id,
          userName: requestedByName,
          action: "CREATE",
          resourceType: "keyGenerationRequest",
          resourceId: request?.id,
          description: `提交无合同密钥申请 ${requestNo}`,
          ip: ctx.req?.headers?.["x-forwarded-for"] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.["user-agent"] || null,
        });

        const notificationInput = {
          requestNo,
          requestedByName,
          mode: input.mode,
          sensorTypes: input.sensorTypes,
          days: input.days,
          count,
          category: input.category,
          reason: input.reason,
          generationRemark: input.generationRemark,
          submittedAt: request.createdAt,
        };
        const cardNotification = await sendFeishuKeyRequestApprovalCard({
          requestId: request.id,
          ...notificationInput,
        });
        if (cardNotification.status !== "sent") {
          if (cardNotification.status === "failed") {
            console.error(
              `[Feishu] 密钥申请 ${requestNo} 审批卡片发送失败：${cardNotification.reason}${
                cardNotification.detail
                  ? `（${cardNotification.detail}）`
                  : ""
              }`,
            );
          }
          const notification = await notifyFeishuKeyRequest(notificationInput);
          if (notification.status === "failed") {
            console.error(
              `[Feishu] 密钥申请 ${requestNo} Webhook 兜底通知失败：${notification.reason}`,
            );
          }
        }
        if (
          cardNotification.status === "skipped" &&
          cardNotification.reason !== "not_configured"
        ) {
          console.warn(
            `[Feishu] 审批卡片配置未完成（${cardNotification.reason}），当前使用自定义机器人文本通知`,
          );
        }
        return request;
      }),

    list: protectedProcedure
      .input(
        z.object({
          page: z.number().min(1).default(1),
          pageSize: z.number().min(1).max(100).default(20),
          status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        return getKeyGenerationRequests({
          ...input,
          requestedById:
            ctx.user.role === "super_admin" ? undefined : ctx.user.id,
        });
      }),

    review: superAdminProcedure
      .input(
        z.object({
          id: z.number(),
          decision: z.enum(["APPROVE", "REJECT"]),
          remark: z.string().trim().max(1000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return reviewKeyGenerationRequest({
          requestId: input.id,
          decision: input.decision,
          remark: input.remark,
          reviewer: {
            id: ctx.user.id,
            name: ctx.user.name || ctx.user.username,
          },
          audit: {
            source: "website",
            ip:
              (ctx.req?.headers?.["x-forwarded-for"] as string) ||
              ctx.req?.socket?.remoteAddress ||
              null,
            userAgent: ctx.req?.headers?.["user-agent"] || null,
          },
        });
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
        pageSize: z.number().min(1).max(1000).default(50),
        source: z.enum(["db", "feishu"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        if (input.source === "feishu") {
          const submitterScope = getFeishuContractSubmitterScope(ctx.user);
          if (submitterScope === null) {
            return {
              items: [],
              total: 0,
              source: "feishu" as const,
              error: "当前子账号未设置姓名，无法按飞书“提交人”匹配合同，请联系管理员完善账号姓名",
            };
          }
          try {
            const result = await getFeishuContracts({
              status: input.status,
              ...(submitterScope ? { submitter: submitterScope } : {}),
              page: input.page,
              pageSize: input.pageSize,
            });
            const keyCounts = await getGeneratedKeyCountsByContractNos(
              result.items.map((item) => item.contractNo)
            );
            return {
              ...result,
              items: result.items.map((item) => ({
                ...item,
                generatedKeyCount: keyCounts[item.contractNo] ?? 0,
              })),
            };
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error instanceof Error ? error.message : "读取飞书合同表失败",
            });
          }
        }
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        return getContracts({ ...input, userIds });
      }),

    /** 获取单个合同 */
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getContractById(input.id);
      }),

    /** 创建合同 */
    create: protectedProcedure
      .input(z.object({
        contractNo: z.string().min(1, "合同编号不能为空"),
        title: z.string().min(1, "合同标题不能为空"),
        customerId: z.number().optional(),
        customerName: z.string().optional(),
        signDate: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        totalKeys: z.number().min(0).optional(),
        status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).optional(),
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
    update: protectedProcedure
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

    /** 删除合同（硬删除，关联密钥则拦截） */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getContractById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "合同不存在" });

        // 权限：非超级管理员只能删自己创建的
        if (ctx.user.role !== "super_admin") {
          const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
          if (!userIds.includes(existing.createdById)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "无权删除此合同" });
          }
        }

        // 存在未吊销的关联密钥时拦截，需先吊销密钥
        const activeKeyCount = await getContractActiveKeyCount(input.id);
        if (activeKeyCount > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "当前合同存在关联密钥！请先吊销密钥后再删除合同。",
          });
        }

        // 删除合同：自动解除已吊销密钥的合同归属（密钥仍保留，归属显示 "-"）
        await deleteContract(input.id);
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name || ctx.user.username,
          action: "DELETE",
          resourceType: "contract",
          resourceId: input.id,
          description: `删除合同 ${existing.contractNo}`,
          ip: ctx.req?.headers?.['x-forwarded-for'] as string || ctx.req?.socket?.remoteAddress || null,
          userAgent: ctx.req?.headers?.['user-agent'] || null,
        });
        return { success: true };
      }),
  }),

  // ===== 设备码读取记录 =====
  deviceCodes: router({
    /** 记录一次"连接并读取 MAC"（成功/失败都记） */
    record: protectedProcedure
      .input(z.object({
        deviceType: z.enum(["foot", "seat", "dummy"]),
        slot: z.string().min(1),
        slotLabel: z.string().optional(),
        mac: z.string().optional(),
        success: z.boolean(),
        contractId: z.number().optional(),
        contractNo: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await createDeviceCodeRecord({
          deviceType: input.deviceType,
          slot: input.slot,
          slotLabel: input.slotLabel || null,
          mac: input.mac || null,
          success: input.success,
          contractId: input.contractId ?? null,
          contractNo: input.contractNo || null,
          createdById: ctx.user.id,
          createdByName: ctx.user.name || ctx.user.username,
        });
        return { success: true };
      }),

    /** 设备码读取记录列表 */
    list: protectedProcedure
      .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
        deviceType: z.enum(["foot", "seat", "dummy"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        return getDeviceCodeRecords({
          userIds,
          page: input.page,
          pageSize: input.pageSize,
          deviceType: input.deviceType,
        });
      }),

    /** 删除一条设备码读取记录 */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const rec = await getDeviceCodeRecordById(input.id);
        if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "记录不存在" });
        if (ctx.user.role !== "super_admin") {
          const userIds = await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
          if (!userIds.includes(rec.createdById)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "无权删除此记录" });
          }
        }
        await deleteDeviceCodeRecord(input.id);
        return { success: true };
      }),
  }),

  // ─── 用户反馈管理 ───────────────────────────────────────────────────────────
  feedback: router({
    /** 反馈列表（分页 + 状态/类型筛选 + 关键字搜索） */
    list: protectedProcedure
      .input(z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
        status: z.enum(["pending", "processing", "resolved", "closed"]).optional(),
        type: z.string().max(32).optional(),
        keyword: z.string().max(128).optional(),
      }))
      .query(async ({ ctx, input }) => {
        // 数据域:超管看全部;管理员看自己+下属;子账号仅看自己创建密钥回来的反馈
        const scopeUserIds = ctx.user.role === "super_admin"
          ? undefined
          : await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        return getFeedbackList({ ...input, scopeUserIds });
      }),

    /** 各状态计数（同样按数据域过滤） */
    stats: protectedProcedure.query(async ({ ctx }) => {
      const scopeUserIds = ctx.user.role === "super_admin"
        ? undefined
        : await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
      return getFeedbackStats(scopeUserIds);
    }),

    /** 更新反馈处理状态 / 备注（仅限本数据域内） */
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "processing", "resolved", "closed"]).optional(),
        remark: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const rec = await getFeedbackById(input.id);
        if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "反馈不存在" });
        const scopeUserIds = ctx.user.role === "super_admin"
          ? undefined
          : await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        if (!(await isFeedbackInScope(input.id, scopeUserIds))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权操作此反馈" });
        }
        await updateFeedback(input.id, {
          status: input.status,
          remark: input.remark,
          handledById: ctx.user.id,
          handledByName: ctx.user.name || ctx.user.username,
        });
        return { success: true };
      }),

    /** 删除反馈（管理员及以上，且仅限本数据域内） */
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const rec = await getFeedbackById(input.id);
        if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "反馈不存在" });
        const scopeUserIds = ctx.user.role === "super_admin"
          ? undefined
          : await getUserAndSubordinateIds(ctx.user.id, ctx.user.role);
        if (!(await isFeedbackInScope(input.id, scopeUserIds))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权操作此反馈" });
        }
        await deleteFeedback(input.id);
        return { success: true };
      }),
  }),

  // ===== 部门管理（部门↔传感器分组↔管理员；仅超管增删改，列表所有登录可读供选择器用） =====
  departments: router({
    list: protectedProcedure.query(async () => getDepartments()),
    create: superAdminProcedure
      .input(z.object({
        name: z.string().min(1, "部门名不能为空").max(128),
        sensorGroup: z.string().nullable().optional(),
        managerId: z.number().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await createDepartment({ name: input.name, sensorGroup: input.sensorGroup ?? null, managerId: input.managerId ?? null });
        return { success: true };
      }),
    update: superAdminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(128).optional(),
        sensorGroup: z.string().nullable().optional(),
        managerId: z.number().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await updateDepartment(input.id, { name: input.name, sensorGroup: input.sensorGroup, managerId: input.managerId });
        return { success: true };
      }),
    delete: superAdminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const res = await deleteDepartment(input.id);
        if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `该部门下还有 ${res.memberCount} 个账号，请先转移或删除后再删除部门` });
        return { success: true };
      }),
  }),

});

export type AppRouter = typeof appRouter;
