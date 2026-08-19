type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type KeyRequestNotificationInput = {
  requestNo: string;
  requestedByName: string;
  mode: "single" | "batch";
  sensorTypes: string | string[];
  days: number;
  count: number;
  category: "production" | "rental";
  reason: string;
  generationRemark?: string;
  submittedAt?: Date;
};

export type FeishuWebhookResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "not_configured" }
  | {
      status: "failed";
      reason:
        | "invalid_webhook_url"
        | "request_failed"
        | "invalid_response"
        | "feishu_rejected";
    };

type FeishuWebhookResponse = {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
};

function formatSensorTypes(sensorTypes: string | string[]) {
  if (sensorTypes === "all") return "全部传感器";
  if (Array.isArray(sensorTypes)) return sensorTypes.join("、");
  return sensorTypes;
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

export function buildKeyRequestNotificationText(
  input: KeyRequestNotificationInput,
) {
  const generationMode =
    input.mode === "batch" ? `批量（${input.count} 个）` : "单个";
  const category =
    input.category === "production" ? "量产密钥" : "在线租赁密钥";
  const lines = [
    "[新的无合同密钥申请]",
    `申请编号：${input.requestNo}`,
    `申请人：${input.requestedByName}`,
    `生成方式：${generationMode}`,
    `授权范围：${formatSensorTypes(input.sensorTypes)}`,
    `有效期：${input.days} 天`,
    `密钥类型：${category}`,
    `申请原因：${input.reason}`,
  ];

  if (input.generationRemark?.trim()) {
    lines.push(`生成备注：${input.generationRemark.trim()}`);
  }
  lines.push(`提交时间：${formatSubmittedAt(input.submittedAt ?? new Date())}`);

  return lines.join("\n");
}

function parseWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    const isValid =
      url.protocol === "https:" &&
      url.hostname === "open.feishu.cn" &&
      /^\/open-apis\/bot\/v2\/hook\/[^/]+$/.test(url.pathname);
    return isValid ? url : null;
  } catch {
    return null;
  }
}

export async function notifyFeishuKeyRequest(
  input: KeyRequestNotificationInput,
  options: {
    webhookUrl?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<FeishuWebhookResult> {
  const webhookUrl = (
    options.webhookUrl ??
    process.env.FEISHU_KEY_REQUEST_WEBHOOK_URL ??
    ""
  ).trim();
  if (!webhookUrl) {
    return { status: "skipped", reason: "not_configured" };
  }

  const parsedUrl = parseWebhookUrl(webhookUrl);
  if (!parsedUrl) {
    return { status: "failed", reason: "invalid_webhook_url" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 5000,
  );

  try {
    const response = await (options.fetchImpl ?? fetch)(parsedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text: buildKeyRequestNotificationText(input) },
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let payload: FeishuWebhookResponse;
    try {
      payload = JSON.parse(rawBody) as FeishuWebhookResponse;
    } catch {
      return { status: "failed", reason: "invalid_response" };
    }

    const code =
      typeof payload.code === "number" ? payload.code : payload.StatusCode;
    if (!response.ok || code !== 0) {
      return { status: "failed", reason: "feishu_rejected" };
    }
    return { status: "sent" };
  } catch {
    return { status: "failed", reason: "request_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
