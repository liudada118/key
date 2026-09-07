import crypto from "crypto";
import express, { type Express, type Request, type Response } from "express";
import { TRPCError } from "@trpc/server";
import { getActiveSuperAdmin } from "./db";
import { buildFeishuKeyRequestResolvedCard } from "./feishuKeyRequestCard";
import { reviewKeyGenerationRequest } from "./keyGenerationRequestApproval";

export const FEISHU_KEY_REQUEST_CALLBACK_PATH =
  "/api/feishu/key-request/card-action";

type JsonRecord = Record<string, unknown>;

type FeishuCallbackConfig = {
  appId: string;
  chatId: string;
  verificationToken: string;
  encryptKey?: string;
};

type ParsedCardAction = {
  decision: "APPROVE" | "REJECT";
  requestId: number;
  requestNo: string;
  operatorOpenId: string;
  chatId: string;
};

export class FeishuCallbackError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "FeishuCallbackError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function calculateFeishuCallbackSignature(params: {
  timestamp: string;
  nonce: string;
  encryptKey: string;
  rawBody: string;
}) {
  return crypto
    .createHash("sha256")
    .update(
      params.timestamp + params.nonce + params.encryptKey + params.rawBody,
    )
    .digest("hex");
}

export function decryptFeishuCallback(
  encryptedValue: string,
  encryptKey: string,
) {
  const encrypted = Buffer.from(encryptedValue, "base64");
  if (encrypted.length <= 16 || (encrypted.length - 16) % 16 !== 0) {
    throw new FeishuCallbackError("飞书回调密文格式无效", 400);
  }

  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    key,
    encrypted.subarray(0, 16),
  );
  const decrypted = Buffer.concat([
    decipher.update(encrypted.subarray(16)),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function parseJsonObject(rawBody: string) {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new FeishuCallbackError("飞书回调不是有效 JSON", 400);
  }
  if (!isRecord(value)) {
    throw new FeishuCallbackError("飞书回调结构无效", 400);
  }
  return value;
}

export function decodeFeishuCallbackPayload(
  rawBody: string,
  encryptKey?: string,
) {
  const envelope = parseJsonObject(rawBody);
  if (typeof envelope.encrypt !== "string") return envelope;
  if (!encryptKey) {
    throw new FeishuCallbackError("服务器未配置飞书回调 Encrypt Key", 503);
  }
  return parseJsonObject(decryptFeishuCallback(envelope.encrypt, encryptKey));
}

function getVerificationToken(payload: JsonRecord) {
  const header = isRecord(payload.header) ? payload.header : undefined;
  const token = header?.token ?? payload.token;
  return typeof token === "string" ? token : "";
}

function getCallbackConfig(): FeishuCallbackConfig {
  const appId = (process.env.FEISHU_APP_ID || "").trim();
  const chatId = (process.env.FEISHU_APPROVAL_CHAT_ID || "").trim();
  const verificationToken = (
    process.env.FEISHU_VERIFICATION_TOKEN || ""
  ).trim();
  const encryptKey = (process.env.FEISHU_CALLBACK_ENCRYPT_KEY || "").trim();

  if (!appId || !chatId || !verificationToken) {
    throw new FeishuCallbackError("飞书审批回调配置不完整", 503);
  }
  return {
    appId,
    chatId,
    verificationToken,
    ...(encryptKey ? { encryptKey } : {}),
  };
}

export function verifyFeishuCallback(params: {
  rawBody: string;
  payload: JsonRecord;
  headers: {
    timestamp?: string;
    nonce?: string;
    signature?: string;
  };
  config: FeishuCallbackConfig;
  now?: number;
  requireSignature?: boolean;
}) {
  const token = getVerificationToken(params.payload);
  if (!token || !safeEqual(token, params.config.verificationToken)) {
    throw new FeishuCallbackError("飞书回调 Verification Token 无效", 401);
  }

  if (!params.config.encryptKey || params.requireSignature === false) return;
  const { timestamp, nonce, signature } = params.headers;
  if (!timestamp || !nonce || !signature) {
    throw new FeishuCallbackError("飞书回调缺少签名请求头", 401);
  }
  const timestampNumber = Number(timestamp);
  const now = params.now ?? Date.now();
  if (
    !Number.isFinite(timestampNumber) ||
    Math.abs(now - timestampNumber * 1000) > 5 * 60 * 1000
  ) {
    throw new FeishuCallbackError("飞书回调时间戳已过期", 401);
  }
  const expected = calculateFeishuCallbackSignature({
    timestamp,
    nonce,
    encryptKey: params.config.encryptKey,
    rawBody: params.rawBody,
  });
  if (!safeEqual(signature, expected)) {
    throw new FeishuCallbackError("飞书回调签名无效", 401);
  }
}

export function parseFeishuKeyRequestCardAction(
  payload: JsonRecord,
  config: FeishuCallbackConfig,
): ParsedCardAction {
  const header = isRecord(payload.header) ? payload.header : undefined;
  if (header?.event_type !== "card.action.trigger") {
    throw new FeishuCallbackError("不支持的飞书回调类型", 400);
  }
  if (header.app_id !== config.appId) {
    throw new FeishuCallbackError("飞书回调 App ID 不匹配", 401);
  }

  const event = isRecord(payload.event) ? payload.event : undefined;
  const action = event && isRecord(event.action) ? event.action : undefined;
  const value = action && isRecord(action.value) ? action.value : undefined;
  const context = event && isRecord(event.context) ? event.context : undefined;
  const operator =
    event && isRecord(event.operator) ? event.operator : undefined;
  if (!value || !context || !operator) {
    throw new FeishuCallbackError("飞书卡片操作数据不完整", 400);
  }
  if (value.source !== "key_manager") {
    throw new FeishuCallbackError("飞书卡片来源无效", 400);
  }

  const decision = value.action;
  if (decision !== "APPROVE" && decision !== "REJECT") {
    throw new FeishuCallbackError("飞书卡片审批动作无效", 400);
  }
  const requestId = Number(value.request_id);
  const requestNo =
    typeof value.request_no === "string" ? value.request_no.trim() : "";
  const operatorOpenId =
    typeof operator.open_id === "string" ? operator.open_id.trim() : "";
  const chatId =
    typeof context.open_chat_id === "string" ? context.open_chat_id.trim() : "";
  if (
    !Number.isSafeInteger(requestId) ||
    requestId <= 0 ||
    !requestNo ||
    !operatorOpenId ||
    !chatId
  ) {
    throw new FeishuCallbackError("飞书卡片审批参数无效", 400);
  }
  if (chatId !== config.chatId) {
    throw new FeishuCallbackError("当前飞书群无权审批密钥申请", 403);
  }

  return {
    decision,
    requestId,
    requestNo,
    operatorOpenId,
    chatId,
  };
}

function maskOpenId(openId: string) {
  return openId.length > 8 ? `***${openId.slice(-8)}` : openId;
}

function callbackToast(type: "success" | "error" | "warning", content: string) {
  return { toast: { type, content } };
}

function requestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0] || null;
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim();
  return req.socket.remoteAddress || null;
}

async function handleCardAction(params: {
  payload: JsonRecord;
  config: FeishuCallbackConfig;
  req: Request;
}) {
  const action = parseFeishuKeyRequestCardAction(params.payload, params.config);
  const reviewer = await getActiveSuperAdmin(
    process.env.FEISHU_APPROVAL_REVIEWER_USERNAME,
  );
  if (!reviewer) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "未找到可用于飞书审批的启用状态超级管理员账号",
    });
  }

  const reviewerName = `${reviewer.name || reviewer.username}（飞书群）`;
  const result = await reviewKeyGenerationRequest({
    requestId: action.requestId,
    expectedRequestNo: action.requestNo,
    decision: action.decision,
    remark:
      action.decision === "APPROVE"
        ? "通过飞书群审批卡片同意"
        : "通过飞书群审批卡片拒绝",
    reviewer: {
      id: reviewer.id,
      name: reviewerName,
    },
    audit: {
      source: "feishu",
      operatorReference: maskOpenId(action.operatorOpenId),
      ip: requestIp(params.req),
      userAgent: params.req.headers["user-agent"] || "Feishu card callback",
    },
  });

  return {
    toast: {
      type: "success",
      content:
        action.decision === "APPROVE"
          ? `已同意，生成 ${result.generatedKeyCount} 个密钥`
          : "已拒绝该申请",
    },
    card: {
      type: "raw",
      data: buildFeishuKeyRequestResolvedCard({
        requestNo: action.requestNo,
        decision: action.decision,
        reviewerName,
        generatedKeyCount: result.generatedKeyCount,
      }),
    },
  };
}

function sendCallbackError(res: Response, error: unknown) {
  if (error instanceof FeishuCallbackError) {
    res.status(error.httpStatus).json(callbackToast("error", error.message));
    return;
  }
  if (error instanceof TRPCError) {
    const type = error.code === "CONFLICT" ? "warning" : "error";
    res.status(200).json(callbackToast(type, error.message));
    return;
  }
  console.error("[Feishu] 处理密钥申请卡片回调失败", error);
  res.status(200).json(callbackToast("error", "审批失败，请稍后重试"));
}

export function registerFeishuKeyRequestCardCallback(app: Express) {
  app.post(
    FEISHU_KEY_REQUEST_CALLBACK_PATH,
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      try {
        const rawBody = Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : "";
        if (!rawBody) {
          throw new FeishuCallbackError("飞书回调请求体为空", 400);
        }

        const config = getCallbackConfig();
        const payload = decodeFeishuCallbackPayload(rawBody, config.encryptKey);
        const challenge =
          typeof payload.challenge === "string" ? payload.challenge : "";

        verifyFeishuCallback({
          rawBody,
          payload,
          headers: {
            timestamp: req.header("X-Lark-Request-Timestamp") || undefined,
            nonce: req.header("X-Lark-Request-Nonce") || undefined,
            signature: req.header("X-Lark-Signature") || undefined,
          },
          config,
          requireSignature: !challenge,
        });

        if (challenge) {
          res.json({ challenge });
          return;
        }
        res.json(await handleCardAction({ payload, config, req }));
      } catch (error) {
        sendCallbackError(res, error);
      }
    },
  );
}
