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

  it.each(["1785400000", "1785400000.000", "1785400000000", "1785400000000.000", "1785400000000000", "1785400000000000000", "1.7854e15", "1.7854e+18"])("verifies token, original signature and numeric timestamp %s", timestamp => {
    const payload = cardActionPayload();
    const rawBody = JSON.stringify({ encrypt: encryptPayload(payload) });
    const now = 1785400000000;
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
        now,
      }),
    ).not.toThrow();
  });

  it.each(["1785399699", "1785400301", "1785399699000", "1785400301000", "1785399699000000", "1785400301000000", "1785399699000000000", "1785400301000000000", "0x6a6b6120", "Infinity", "NaN", "1e999", "-1785400000", " 1785400000", "1.2.3", "not-a-timestamp"])("rejects stale, future or malformed signed timestamps (%s)", timestamp => {
    const payload = cardActionPayload(), rawBody = JSON.stringify(payload), nonce = "nonce-value";
    const signature = calculateFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody });
    expect(() => verifyFeishuCallback({ rawBody, payload, headers: { timestamp, nonce, signature },
      config: { appId, chatId, verificationToken, encryptKey }, now: 1785400000000,
    })).toThrow("飞书回调时间戳已过期");
  });

  it.each(["1785400000.125", "1785400000125.0", "1785400000125000", "1785400000125000000"])("checks subsecond freshness without rewriting timestamp %s", timestamp => {
    const payload = cardActionPayload(), rawBody = JSON.stringify(payload), nonce = "nonce-value";
    const signature = calculateFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody });
    expect(() => verifyFeishuCallback({ rawBody, payload, headers: { timestamp, nonce, signature },
      config: { appId, chatId, verificationToken, encryptKey }, now: 1785400000125,
    })).not.toThrow();
  });

  it("does not normalize a millisecond header before signature verification", () => {
    const payload = cardActionPayload(), rawBody = JSON.stringify(payload), nonce = "nonce-value";
    const signature = calculateFeishuCallbackSignature({ timestamp: "1785400000", nonce, encryptKey, rawBody });
    expect(() => verifyFeishuCallback({ rawBody, payload, headers: { timestamp: "1785400000000", nonce, signature },
      config: { appId, chatId, verificationToken, encryptKey }, now: 1785400000000,
    })).toThrow("飞书回调签名无效");
  });

  it.each([
    "2026-10-28 08:59:44.1234567 +0000 UTC m=+1234.123456789",
    "2026-10-28 08:59:44.12345678 +0000 UTC m=+12345.123456789",
    "2026-10-28 16:59:44.123456789 +0800 CST m=+12345.123456789",
    "2026-10-28 01:59:44.123 -0700 PDT m=-1234.123456789",
    "2026-10-28 14:29:44.123 +0530 IST",
    "2026-10-28 08:59:44 +0000 UTC",
  ])("accepts the observed signed Go time shape with explicit numeric timezone (%s)", timestamp => {
    const payload = cardActionPayload(), rawBody = JSON.stringify(payload), nonce = "synthetic-nonce";
    const signature = calculateFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody });
    expect(() => verifyFeishuCallback({ rawBody, payload, headers: { timestamp, nonce, signature },
      config: { appId, chatId, verificationToken, encryptKey }, now: Date.parse("2026-10-28T08:59:44.123Z"),
    })).not.toThrow();
  });

  it.each([
    "2026-10-28 08:49:44.123 +0000 UTC m=+99999.123456789",
    "2026-10-28 09:09:44.123 +0000 UTC m=+0.123456789",
    "2026-02-30 08:59:44.123 +0000 UTC",
    "2026-10-28 24:59:44.123 +0000 UTC",
    "2026-10-28 08:59:44.123 +0860 UTC",
    "2026-10-28 08:59:44.123 +2400 UTC",
    "2026-10-28 08:59:44.123 UTC",
    "2026-10-28 08:59:44.1234567890 +0000 UTC",
    "2026-10-28 08:59:44.123 +0000 UTC m=invalid",
    "2026-10-28 08:59:44.123 +0000 UTC m=+0.123456789 extra",
  ])("rejects expired/future or malformed signed Go time without using the monotonic suffix (%s)", timestamp => {
    const payload = cardActionPayload(), rawBody = JSON.stringify(payload), nonce = "synthetic-nonce";
    const signature = calculateFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody });
    expect(() => verifyFeishuCallback({ rawBody, payload, headers: { timestamp, nonce, signature },
      config: { appId, chatId, verificationToken, encryptKey }, now: Date.parse("2026-10-28T08:59:44.123Z"),
    })).toThrow("飞书回调时间戳已过期");
  });

  it("verifies the complete Go header, including its monotonic suffix", () => {
    const timestamp = "2026-10-28 08:59:44.123456789 +0000 UTC m=+12345.123456789";
    const payload = cardActionPayload(), rawBody = JSON.stringify(payload), nonce = "synthetic-nonce";
    const signature = calculateFeishuCallbackSignature({ timestamp: timestamp.split(" m=")[0], nonce, encryptKey, rawBody });
    expect(() => verifyFeishuCallback({ rawBody, payload, headers: { timestamp, nonce, signature },
      config: { appId, chatId, verificationToken, encryptKey }, now: Date.parse("2026-10-28T08:59:44.123Z"),
    })).toThrow("飞书回调签名无效");
  });

  it("reports only a masked shape of an unsupported authenticated date header", () => {
    const timestamp = "2026-10-28T08:57:00.000Z", now = Date.parse(timestamp);
    const payload = cardActionPayload(), rawBody = JSON.stringify(payload), nonce = "private-nonce";
    const signature = calculateFeishuCallbackSignature({ timestamp, nonce, encryptKey, rawBody });
    let rejected: unknown;
    try {
      verifyFeishuCallback({ rawBody, payload, headers: { timestamp, nonce, signature },
        config: { appId, chatId, verificationToken, encryptKey }, now });
    } catch (error) { rejected = error; }
    expect(rejected).toMatchObject({ httpStatus: 401, diagnostics: {
      timestampUnit: "invalid", timestampLength: timestamp.length,
      timestampShape: "0000-00-00a00:00:00.000a", parsedDateClockSkewSeconds: 0,
    } });
    const diagnostics = JSON.stringify((rejected as { diagnostics: unknown }).diagnostics);
    for (const secret of [timestamp, nonce, signature, encryptKey, verificationToken]) expect(diagnostics).not.toContain(secret);
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
