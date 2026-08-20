import { describe, expect, it, vi } from "vitest";
import {
  buildKeyRequestNotificationText,
  notifyFeishuKeyRequest,
  type KeyRequestNotificationInput,
} from "./feishuKeyRequestWebhook";

const request: KeyRequestNotificationInput = {
  requestNo: "KGR-20260730-TEST1234",
  requestedByName: "测试申请人",
  mode: "batch",
  sensorTypes: ["hand", "seat"],
  days: 30,
  count: 3,
  category: "production",
  reason: "客户现场急用",
  generationRemark: "回归测试",
  submittedAt: new Date("2026-07-30T08:00:00.000Z"),
};

describe("Feishu key request webhook", () => {
  it("formats all application details", () => {
    const text = buildKeyRequestNotificationText(request);

    expect(text).toContain("申请编号：KGR-20260730-TEST1234");
    expect(text).toContain("申请人：测试申请人");
    expect(text).toContain("生成方式：批量（3 个）");
    // hand 有中文名 → 手部检测；seat 不在清单里 → 原样显示
    expect(text).toContain("授权范围：手部检测、seat");
    expect(text).toContain("有效期：30 天");
    expect(text).toContain("申请原因：客户现场急用");
    expect(text).toContain("生成备注：回归测试");
    expect(text).toContain("提交时间：2026/07/30 16:00:00");
  });

  it("renders a category token as its Chinese scope label", () => {
    const text = buildKeyRequestNotificationText({
      ...request,
      sensorTypes: ["@group:precision", "humanBodyOptimized"],
    });
    expect(text).toContain("授权范围：精密全部、人体全身优化");
  });

  it("posts a UTF-8 text message to the configured webhook", async () => {
    const fetchMock = vi.fn<
      Parameters<typeof fetch>,
      ReturnType<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: "success" }), {
        status: 200,
      }),
    );

    const result = await notifyFeishuKeyRequest(request, {
      webhookUrl:
        "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook-id",
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({ status: "sent" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook-id",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json; charset=utf-8",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      msg_type: "text",
      content: {
        text: expect.stringContaining("申请编号：KGR-20260730-TEST1234"),
      },
    });
  });

  it("skips cleanly when the webhook is not configured", async () => {
    const fetchMock = vi.fn();

    await expect(
      notifyFeishuKeyRequest(request, {
        webhookUrl: "",
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isolates Feishu rejection and network failures", async () => {
    const rejectedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 19001, msg: "rejected" }), {
        status: 200,
      }),
    );
    const failedFetch = vi.fn().mockRejectedValue(new Error("network error"));

    await expect(
      notifyFeishuKeyRequest(request, {
        webhookUrl:
          "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook-id",
        fetchImpl: rejectedFetch,
      }),
    ).resolves.toEqual({ status: "failed", reason: "feishu_rejected" });

    await expect(
      notifyFeishuKeyRequest(request, {
        webhookUrl:
          "https://open.feishu.cn/open-apis/bot/v2/hook/test-webhook-id",
        fetchImpl: failedFetch,
      }),
    ).resolves.toEqual({ status: "failed", reason: "request_failed" });
  });

  it("rejects non-Feishu webhook URLs before sending", async () => {
    const fetchMock = vi.fn();

    await expect(
      notifyFeishuKeyRequest(request, {
        webhookUrl: "https://example.com/open-apis/bot/v2/hook/test",
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({
      status: "failed",
      reason: "invalid_webhook_url",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
