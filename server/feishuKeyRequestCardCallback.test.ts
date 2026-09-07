import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  calculateFeishuCallbackSignature,
  decodeFeishuCallbackPayload,
  parseFeishuKeyRequestCardAction,
  verifyFeishuCallback,
} from "./feishuKeyRequestCardCallback";

const verificationToken = "verification-token";
const encryptKey = "encrypt-key";
const appId = "cli_test";
const chatId = "oc_approval_chat";

function encryptPayload(payload: unknown) {
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const iv = Buffer.alloc(16, 7);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

function cardActionPayload(overrides: Record<string, unknown> = {}) {
  return {
    schema: "2.0",
    header: {
      event_type: "card.action.trigger",
      token: verificationToken,
      app_id: appId,
    },
    event: {
      operator: { open_id: "ou_approver" },
      action: {
        value: {
          source: "key_manager",
          action: "APPROVE",
          request_id: 42,
          request_no: "KGR-20260730-TEST1234",
        },
      },
      context: {
        open_chat_id: chatId,
      },
    },
    ...overrides,
  };
}

describe("Feishu key request card callback security", () => {
  it("decrypts encrypted callback envelopes", () => {
    const payload = cardActionPayload();
    const envelope = JSON.stringify({ encrypt: encryptPayload(payload) });

    expect(decodeFeishuCallbackPayload(envelope, encryptKey)).toEqual(payload);
  });

  it("verifies the callback token, signature, and timestamp", () => {
    const payload = cardActionPayload();
    const rawBody = JSON.stringify({ encrypt: encryptPayload(payload) });
    const timestamp = "1785400000";
    const nonce = "nonce-value";
    const signature = calculateFeishuCallbackSignature({
      timestamp,
      nonce,
      encryptKey,
      rawBody,
    });

    expect(() =>
      verifyFeishuCallback({
        rawBody,
        payload,
        headers: { timestamp, nonce, signature },
        config: {
          appId,
          chatId,
          verificationToken,
          encryptKey,
        },
        now: Number(timestamp) * 1000,
      }),
    ).not.toThrow();
  });

  it("rejects invalid verification tokens", () => {
    const payload = cardActionPayload();
    payload.header.token = "wrong-token";

    expect(() =>
      verifyFeishuCallback({
        rawBody: JSON.stringify(payload),
        payload,
        headers: {},
        config: { appId, chatId, verificationToken },
      }),
    ).toThrow("Verification Token 无效");
  });

  it("accepts actions only from the configured approval group", () => {
    const payload = cardActionPayload();
    expect(
      parseFeishuKeyRequestCardAction(payload, {
        appId,
        chatId,
        verificationToken,
      }),
    ).toMatchObject({
      decision: "APPROVE",
      requestId: 42,
      requestNo: "KGR-20260730-TEST1234",
      chatId,
    });

    payload.event.context.open_chat_id = "oc_other_chat";
    expect(() =>
      parseFeishuKeyRequestCardAction(payload, {
        appId,
        chatId,
        verificationToken,
      }),
    ).toThrow("当前飞书群无权审批");
  });
});
