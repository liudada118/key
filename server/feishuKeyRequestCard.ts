import type { KeyRequestNotificationInput } from "./feishuKeyRequestWebhook";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type FeishuTokenResponse = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

type FeishuMessageResponse = {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
};

export type FeishuKeyRequestCardInput = KeyRequestNotificationInput & {
  requestId: number;
};

export type FeishuCardSendResult =
  | { status: "sent"; messageId?: string }
  | {
      status: "skipped";
      reason: "not_configured" | "missing_chat_id" | "missing_callback_config";
    }
  | {
      status: "failed";
      reason:
        | "invalid_chat_id"
        | "request_failed"
        | "invalid_response"
        | "token_rejected"
        | "message_rejected";
      detail?: string;
    };

type TokenCache = {
  appId: string;
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

function escapeCardMarkdown(value: string | number) {
  return String(value).replace(/[\\`*_[\]~<>]/g, "\\$&");
}

function formatSensorTypes(sensorTypes: string | string[]) {
  if (sensorTypes === "all") return "全部传感器";
  return Array.isArray(sensorTypes) ? sensorTypes.join("、") : sensorTypes;
}

function formatSubmittedAt(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function buildActionButton(params: {
  elementId: string;
  text: string;
  type: "primary" | "danger";
  action: "APPROVE" | "REJECT";
  requestId: number;
  requestNo: string;
}) {
  const isApproval = params.action === "APPROVE";
  return {
    tag: "button",
    element_id: params.elementId,
    text: {
      tag: "plain_text",
      content: params.text,
    },
    type: params.type,
    width: "fill",
    size: "medium",
    behaviors: [
      {
        type: "callback",
        value: {
          source: "key_manager",
          action: params.action,
          request_id: params.requestId,
          request_no: params.requestNo,
        },
      },
    ],
    confirm: {
      title: {
        tag: "plain_text",
        content: isApproval ? "确认同意申请" : "确认拒绝申请",
      },
      text: {
        tag: "plain_text",
        content: isApproval
          ? "同意后将立即生成密钥，操作不可撤销。"
          : "拒绝后申请人需要重新提交申请。",
      },
    },
  };
}

export function buildFeishuKeyRequestApprovalCard(
  input: FeishuKeyRequestCardInput,
) {
  const generationMode =
    input.mode === "batch" ? `批量（${input.count} 个）` : "单个";
  const category =
    input.category === "production" ? "量产密钥" : "在线租赁密钥";
  const generationRemark = input.generationRemark?.trim()
    ? `\n**生成备注：** ${escapeCardMarkdown(input.generationRemark.trim())}`
    : "";
  const content = [
    `**申请人：** ${escapeCardMarkdown(input.requestedByName)}`,
    `**生成方式：** ${escapeCardMarkdown(generationMode)}`,
    `**授权范围：** ${escapeCardMarkdown(formatSensorTypes(input.sensorTypes))}`,
    `**有效期：** ${escapeCardMarkdown(input.days)} 天`,
    `**密钥类型：** ${escapeCardMarkdown(category)}`,
    `**申请原因：** ${escapeCardMarkdown(input.reason)}`,
    generationRemark,
    `**提交时间：** ${escapeCardMarkdown(
      formatSubmittedAt(input.submittedAt ?? new Date()),
    )}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill",
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 12px 12px",
      elements: [
        {
          tag: "markdown",
          content,
          text_align: "left",
          margin: "0px 0px 12px 0px",
        },
        {
          tag: "column_set",
          flex_mode: "stretch",
          horizontal_spacing: "8px",
          margin: "0px",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                buildActionButton({
                  elementId: "approve_request",
                  text: "同意并生成密钥",
                  type: "primary",
                  action: "APPROVE",
                  requestId: input.requestId,
                  requestNo: input.requestNo,
                }),
              ],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                buildActionButton({
                  elementId: "reject_request",
                  text: "拒绝",
                  type: "danger",
                  action: "REJECT",
                  requestId: input.requestId,
                  requestNo: input.requestNo,
                }),
              ],
            },
          ],
        },
      ],
    },
    header: {
      title: {
        tag: "plain_text",
        content: "无合同密钥申请",
      },
      subtitle: {
        tag: "plain_text",
        content: input.requestNo,
      },
      template: "orange",
      padding: "12px 12px 12px 12px",
    },
  };
}

export function buildFeishuKeyRequestResolvedCard(params: {
  requestNo: string;
  decision: "APPROVE" | "REJECT";
  reviewerName: string;
  generatedKeyCount: number;
}) {
  const approved = params.decision === "APPROVE";
  const statusText = approved ? "已通过" : "已拒绝";
  const details = approved
    ? `已生成 ${params.generatedKeyCount} 个密钥`
    : "申请未生成密钥";

  return {
    schema: "2.0",
    config: {
      update_multi: true,
      width_mode: "fill",
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 12px 12px",
      elements: [
        {
          tag: "markdown",
          content: [
            `**审批结果：** ${statusText}`,
            `**处理人：** ${escapeCardMarkdown(params.reviewerName)}`,
            `**处理结果：** ${details}`,
          ].join("\n"),
          text_align: "left",
          margin: "0px",
        },
      ],
    },
    header: {
      title: {
        tag: "plain_text",
        content: approved ? "密钥申请已通过" : "密钥申请已拒绝",
      },
      subtitle: {
        tag: "plain_text",
        content: params.requestNo,
      },
      template: approved ? "green" : "red",
      padding: "12px 12px 12px 12px",
    },
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

async function getTenantAccessToken(params: {
  appId: string;
  appSecret: string;
  fetchImpl: FetchLike;
  signal: AbortSignal;
}): Promise<
  | { token: string }
  | {
      error: "invalid_response" | "token_rejected";
      detail?: string;
    }
> {
  const now = Date.now();
  if (
    tokenCache &&
    tokenCache.appId === params.appId &&
    tokenCache.expiresAt > now + 60_000
  ) {
    return { token: tokenCache.token } as const;
  }

  const response = await params.fetchImpl(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: params.appId,
        app_secret: params.appSecret,
      }),
      signal: params.signal,
    },
  );
  const payload = await parseJsonResponse<FeishuTokenResponse>(response);
  if (!payload) return { error: "invalid_response" } as const;
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    return {
      error: "token_rejected",
      detail: payload.msg || String(payload.code ?? response.status),
    } as const;
  }

  tokenCache = {
    appId: params.appId,
    token: payload.tenant_access_token,
    expiresAt: now + Math.max(60, payload.expire ?? 7200) * 1000,
  };
  return { token: payload.tenant_access_token } as const;
}

export async function sendFeishuKeyRequestApprovalCard(
  input: FeishuKeyRequestCardInput,
  options: {
    appId?: string;
    appSecret?: string;
    chatId?: string;
    verificationToken?: string;
    accessToken?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<FeishuCardSendResult> {
  const appId = (options.appId ?? process.env.FEISHU_APP_ID ?? "").trim();
  const appSecret = (
    options.appSecret ??
    process.env.FEISHU_APP_SECRET ??
    ""
  ).trim();
  const chatId = (
    options.chatId ??
    process.env.FEISHU_APPROVAL_CHAT_ID ??
    ""
  ).trim();
  const verificationToken = (
    options.verificationToken ??
    process.env.FEISHU_VERIFICATION_TOKEN ??
    ""
  ).trim();

  if (!appId || (!appSecret && !options.accessToken)) {
    return { status: "skipped", reason: "not_configured" };
  }
  if (!chatId) {
    return { status: "skipped", reason: "missing_chat_id" };
  }
  if (!verificationToken) {
    return { status: "skipped", reason: "missing_callback_config" };
  }
  if (!/^oc_[A-Za-z0-9_-]+$/.test(chatId)) {
    return { status: "failed", reason: "invalid_chat_id" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 5000,
  );

  try {
    let accessToken = options.accessToken;
    if (!accessToken) {
      const tokenResult = await getTenantAccessToken({
        appId,
        appSecret,
        fetchImpl,
        signal: controller.signal,
      });
      if ("error" in tokenResult) {
        return {
          status: "failed",
          reason: tokenResult.error,
          ...("detail" in tokenResult ? { detail: tokenResult.detail } : {}),
        };
      }
      accessToken = tokenResult.token;
    }

    const response = await fetchImpl(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "interactive",
          content: JSON.stringify(buildFeishuKeyRequestApprovalCard(input)),
        }),
        signal: controller.signal,
      },
    );
    const payload = await parseJsonResponse<FeishuMessageResponse>(response);
    if (!payload) {
      return { status: "failed", reason: "invalid_response" };
    }
    if (!response.ok || payload.code !== 0) {
      return {
        status: "failed",
        reason: "message_rejected",
        detail: payload.msg || String(payload.code ?? response.status),
      };
    }
    return {
      status: "sent",
      ...(payload.data?.message_id
        ? { messageId: payload.data.message_id }
        : {}),
    };
  } catch {
    return { status: "failed", reason: "request_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
