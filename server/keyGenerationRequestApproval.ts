import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approveKeyGenerationRequestWithKeys,
  createAuditLog,
  getKeyGenerationRequestById,
  rejectKeyGenerationRequest,
} from "./db";
import { prepareOnlineKeyGeneration } from "./onlineKeyGeneration";

const storedSensorTypesSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

export type KeyGenerationReviewDecision = "APPROVE" | "REJECT";

export async function reviewKeyGenerationRequest(params: {
  requestId: number;
  expectedRequestNo?: string;
  decision: KeyGenerationReviewDecision;
  remark?: string | null;
  reviewer: {
    id: number;
    name: string;
  };
  audit?: {
    ip?: string | null;
    userAgent?: string | null;
    source?: "website" | "feishu";
    operatorReference?: string | null;
  };
}) {
  const request = await getKeyGenerationRequestById(params.requestId);
  if (!request) {
    throw new TRPCError({ code: "NOT_FOUND", message: "申请不存在" });
  }
  if (
    params.expectedRequestNo &&
    request.requestNo !== params.expectedRequestNo
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "申请编号与审批卡片不匹配",
    });
  }
  if (request.status !== "PENDING") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "该申请已经处理，不能重复审批",
    });
  }

  const trimmedRemark = params.remark?.trim() || "";
  const auditSuffix =
    params.audit?.source === "feishu"
      ? `（飞书群审批${
          params.audit.operatorReference
            ? `，操作人 ${params.audit.operatorReference}`
            : ""
        }）`
      : "";

  if (params.decision === "REJECT") {
    if (!trimmedRemark) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "拒绝申请时必须填写原因",
      });
    }
    const rejected = await rejectKeyGenerationRequest({
      requestId: request.id,
      reviewerId: params.reviewer.id,
      reviewerName: params.reviewer.name,
      reviewRemark: trimmedRemark,
    });
    if (!rejected) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该申请已经被其他人处理",
      });
    }
    await createAuditLog({
      userId: params.reviewer.id,
      userName: params.reviewer.name,
      action: "UPDATE",
      resourceType: "keyGenerationRequest",
      resourceId: request.id,
      description: `拒绝无合同密钥申请 ${request.requestNo}${auditSuffix}`,
      ip: params.audit?.ip || null,
      userAgent: params.audit?.userAgent || null,
    });
    return { success: true, request: rejected, generatedKeyCount: 0 };
  }

  let storedSensorTypes: unknown;
  try {
    storedSensorTypes = JSON.parse(request.sensorTypes);
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "申请中的传感器参数损坏",
    });
  }
  const parsedSensorTypes =
    storedSensorTypesSchema.safeParse(storedSensorTypes);
  if (!parsedSensorTypes.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "申请中的传感器参数无效",
    });
  }

  const prepared = prepareOnlineKeyGeneration({
    mode: request.mode,
    sensorTypes: parsedSensorTypes.data,
    days: request.days,
    category: request.category,
    count: request.mode === "batch" ? request.count : 1,
    createdById: request.requestedById,
    createdByName: request.requestedByName,
    generationRequestId: request.id,
    remark: request.generationRemark,
  });
  const approved = await approveKeyGenerationRequestWithKeys({
    requestId: request.id,
    reviewerId: params.reviewer.id,
    reviewerName: params.reviewer.name,
    reviewRemark: trimmedRemark || null,
    generatedBatchId: prepared.batchId,
    records: prepared.records,
  });
  if (!approved) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "该申请已经被其他人处理",
    });
  }

  await createAuditLog({
    userId: params.reviewer.id,
    userName: params.reviewer.name,
    action: "UPDATE",
    resourceType: "keyGenerationRequest",
    resourceId: request.id,
    description: `批准无合同密钥申请 ${request.requestNo}，生成 ${prepared.keys.length} 个密钥${auditSuffix}`,
    ip: params.audit?.ip || null,
    userAgent: params.audit?.userAgent || null,
  });
  return {
    success: true,
    request: approved,
    generatedKeyCount: prepared.keys.length,
  };
}
