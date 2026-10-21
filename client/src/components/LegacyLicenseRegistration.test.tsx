import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegacyLicenseRegistrationView } from "./LegacyLicenseRegistration";
const actions = { onReason() {}, onConfirmed() {}, onPreview() {}, onRegister() {} };
const preview = { keyHash: "a".repeat(64), sensorType: "hand", expireTimestamp: 1900000000000, outcome: "DRY_RUN" as const, applied: false, keyId: null };
describe("legacy key reviewed import controls", () => {
  it("explains preserved rights and exposes a labeled reason before preview", () => {
    const html = renderToStaticMarkup(<LegacyLicenseRegistrationView {...actions} reason="" confirmed={false} preview={null} busy={false} error="" completed={false} />);
    expect(html).toContain("客户无需换密钥"); expect(html).toContain("原授权范围和到期时间");
    expect(html).toContain('for="legacy-key-review"'); expect(html).toContain('disabled=""');
    expect(html).not.toContain("确认登记原密钥");
  });
  it("shows only the bounded fingerprint and requires confirmation after preview", () => {
    const html = renderToStaticMarkup(<LegacyLicenseRegistrationView {...actions} reason="已核对签发台账" confirmed={false} preview={preview} busy={false} error="" completed={false} />);
    expect(html).toContain("aaaaaaaaaaaa"); expect(html).not.toContain(preview.keyHash);
    expect(html).toContain("确认登记原密钥"); expect(html).toContain('disabled=""');
  });
  it("keeps actionable error and completion feedback inline", () => {
    const html = renderToStaticMarkup(<LegacyLicenseRegistrationView {...actions} reason="已核对签发台账" confirmed={true} preview={preview} busy={false} error="原密钥已有吊销记录" completed={false} />);
    expect(html).toContain('role="alert"'); expect(html).toContain("原密钥已有吊销记录");
    const done = renderToStaticMarkup(<LegacyLicenseRegistrationView {...actions} reason="已核对签发台账" confirmed={true} preview={{ ...preview, outcome: "REGISTERED", applied: true }} busy={false} error="" completed={true} />);
    expect(done).toContain("联网重新验证原密钥"); expect(done).not.toContain("确认登记原密钥");
  });
});
