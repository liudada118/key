import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout from "./DashboardLayout";

const session = vi.hoisted(() => ({ path: "/", role: "super_admin", pending: 0, approved: 0, tampered: 0 }));
const queries = vi.hoisted(() => ({ requests: vi.fn(), tampered: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  keyGenerationRequests: { notifications: { useQuery: queries.requests } },
  keys: { tamperedCount: { useQuery: queries.tampered } },
} }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: { name: "Test", role: session.role }, logout: vi.fn() }),
}));
vi.mock("wouter", () => ({ useLocation: () => [session.path, vi.fn()] }));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

describe("sidebar disclosure and direct license navigation", () => {
  beforeEach(() => {
    session.path = "/";
    session.role = "super_admin";
    session.pending = session.approved = session.tampered = 0;
    queries.requests.mockClear().mockImplementation(() => ({ data: { pending: session.pending, approved: session.approved } }));
    queries.tampered.mockClear().mockImplementation(() => ({ data: session.tampered }));
    vi.stubGlobal("React", React);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  const render = () => renderToStaticMarkup(<DashboardLayout><p>Content</p></DashboardLayout>);

  it("keeps license entries directly visible and collapses the three secondary sections", () => {
    const html = render();
    expect(html).toContain("仪表盘");
    expect(html.match(/data-slot="collapsible-trigger"/g)).toHaveLength(3);
    for (const label of ["生成密钥", "密钥管理", "无合同申请", "异常密钥", "生成离线密钥", "离线密钥管理", "密钥验证"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("设备工具");
    expect(html).not.toContain("MAC 读取");
    expect(html).not.toContain("脚垫设备码");
    expect(html).not.toContain("部门管理");
    expect(html).not.toContain("Agent 聊天");
    expect(html).toContain('aria-label="收起导航"');
  });

  it.each(["/mac-reader", "/foot-device-code", "/seat-device-code", "/dummy-device-code"])("opens device tools for direct navigation to %s", (path) => {
    session.path = path;
    const html = render();
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("生成密钥");
    expect(html).toContain("无合同申请");
    expect(html).toContain("生成离线密钥");
    for (const label of ["MAC 读取", "脚垫设备码", "坐垫设备码", "假人设备码"]) {
      expect(html).toContain(label);
    }
  });

  it("preserves restricted menu visibility within an expanded section", () => {
    session.path = "/feedback";
    session.role = "user";
    const html = render();
    expect(html).toContain("反馈管理");
    expect(html).toContain("公司系统库");
    expect(html).not.toContain("Agent 聊天");
    expect(html).not.toContain("SDK 获取");
    expect(html).not.toContain("异常密钥");
  });

  it("shows super-admin entries when their section is active", () => {
    session.path = "/agent-chats";
    const html = render();
    expect(html).toContain("Agent 聊天");
    expect(html).toContain("客户使用分析");
    expect(html).toContain("SDK 获取");
  });

  it.each(["/limited-generate", "/limited-keys"])("keeps the restricted category visible and marks %s active", (path) => {
    session.path = path;
    const html = render();
    expect(html).toContain("限制密钥");
    expect(html).toContain("生成限制密钥");
    expect(html).toContain("限制密钥管理");
    expect(html).toContain('aria-current="page"');
  });

  it.each(["admin", "user"])("hides restricted key navigation from %s", role => {
    session.role = role;
    const html = render();
    expect(html).not.toContain("限制密钥");
    expect(html).toContain("生成密钥");
  });

  it("places abnormal keys in the always-visible online section only once", () => {
    const html = render();
    expect(html.indexOf('aria-label="异常密钥"')).toBeLessThan(html.indexOf(">离线密钥</span>"));
    expect(html.match(/aria-label="异常密钥"/g)).toHaveLength(1);
  });

  it("shows pending-approval and unresolved-key notices for the super administrator", () => {
    session.pending = 3;
    session.tampered = 2;
    const html = render();
    expect(html).toContain('aria-label="无合同申请，3 条密钥申请待审批"');
    expect(html).toContain('aria-label="异常密钥，2 把异常密钥待处理"');
    expect(html.match(/data-visible="true"/g)).toHaveLength(2);
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it.each(["admin", "user"])("shows %s their unread approval but never the global pending count", role => {
    session.role = role;
    session.approved = 1;
    session.pending = 99;
    const html = render();
    expect(html).toContain('aria-label="无合同申请，1 条申请已批准，结果未查看"');
    expect(html).not.toContain("99 条密钥申请待审批");
    expect(queries.tampered.mock.calls[0][1].enabled).toBe(role === "admin");
  });

  it("keeps stable dot elements hidden when there is nothing requiring attention", () => {
    const html = render();
    expect(html).toContain('data-slot="navigation-notice"');
    expect(html).not.toContain('data-visible="true"');
    expect(queries.requests.mock.calls[0][1]).toMatchObject({
      refetchInterval: 30_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true,
    });
  });
});
