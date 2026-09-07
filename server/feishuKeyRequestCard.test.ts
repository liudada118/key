import { describe, expect, it, vi } from "vitest";
import {
  buildFeishuKeyRequestApprovalCard,
  buildFeishuKeyRequestResolvedCard,
  sendFeishuKeyRequestApprovalCard,
  type FeishuKeyRequestCardInput,
} from "./feishuKeyRequestCard";

const request: FeishuKeyRequestCardInput = {
  requestId: 42,
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

describe("Feishu key request approval card", () => {
  it("builds an approval card with approve and reject callback values", () => {
    const card = buildFeishuKeyRequestApprovalCard(request);
    const serialized = JSON.stringify(card);

    expect(card.schema).toBe("2.0");
    expect(serialized).toContain("同意并生成密钥");
    expect(serialized).toContain('"action":"APPROVE"');
    expect(serialized).toContain('"action":"REJECT"');
    expect(serialized).toContain('"request_id":42');
    expect(serialized).toContain("KGR-20260730-TEST1234");
    expect(serialized).toContain("客户现场急用");
  });

  it("builds a resolved card without active action buttons", () => {
    const card = buildFeishuKeyRequestResolvedCard({
      requestNo: request.requestNo,
      decision: "APPROVE",
      reviewerName: "超级管理员（飞书群）",
      generatedKeyCount: 3,
    });
    const serialized = JSON.stringify(card);

    expect(card.header.template).toBe("green");
    expect(serialized).toContain("已生成 3 个密钥");
    expect(serialized).not.toContain('"tag":"button"');
  });

  it("sends the card through the application bot message API", async () => {
    const fetchMock = vi.fn<
      Parameters<typeof fetch>,
      ReturnType<typeof fetch>
    >();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          msg: "success",
          data: { message_id: "om_test" },
        }),
        { status: 200 },
      ),
    );

    const result = await sendFeishuKeyRequestApprovalCard(request, {
      appId: "cli_test",
      accessToken: "tenant-token",
      chatId: "oc_test_chat",
      verificationToken: "verification-token",
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({ status: "sent", messageId: "om_test" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/open-apis/im/v1/messages?receive_id_type=chat_id",
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      receive_id: "oc_test_chat",
      msg_type: "interactive",
    });
    expect(JSON.parse(body.content)).toMatchObject({
      schema: "2.0",
      header: {
        subtitle: {
          content: request.requestNo,
        },
      },
    });
  });

  it("falls back cleanly when the approval chat is not configured", async () => {
    const fetchMock = vi.fn();

    await expect(
      sendFeishuKeyRequestApprovalCard(request, {
        appId: "cli_test",
        accessToken: "tenant-token",
        chatId: "",
        fetchImpl: fetchMock,
      }),
    ).resolves.toEqual({
      status: "skipped",
      reason: "missing_chat_id",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
