import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ enabled: false, preview: false }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ invalidate: vi.fn() }),
  uploadRetention: {
    policy: { useQuery: () => ({ data: { enabled: state.enabled } }) },
    audit: { useQuery: () => ({ data: [] }) },
    cleanup: { useMutation: () => ({ isPending: false, data: state.preview ? { dryRun: true } : undefined, mutateAsync: vi.fn() }) },
    delete: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
  },
} }));
import UploadRetentionPanel, { DeleteUploadedButton } from "./UploadRetentionPanel";
describe("upload deletion controls", () => {
  beforeEach(() => { state.enabled = false; state.preview = false; });
  it("explains inactivity retention, local scope, and the operator-controlled worker", () => {
    const html = renderToStaticMarkup(<UploadRetentionPanel />);
    expect(html).toContain("最后成功接收快照起保留180天");
    expect(html).toContain("未启用，需运维配置后生效");
    expect(html).toContain("预览过期数据");
    expect(html).toContain('disabled=""');
  });
  it("enables the confirmation action only after preview and shows the actual worker policy", () => {
    state.enabled = true; state.preview = true;
    const html = renderToStaticMarkup(<UploadRetentionPanel />);
    expect(html).toContain("已由运维启用");
    expect(html).not.toContain('disabled=""');
  });
  it("labels the remote object precisely rather than offering to delete local data", () => {
    const html = renderToStaticMarkup(<DeleteUploadedButton kind="chat" sourceId={1}
      installationId="249c3777-cff6-44e4-99ea-a812e302a992" objectId="conversation" />);
    expect(html).toContain("删除服务器会话");
  });
});
