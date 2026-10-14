import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLayout from "./DashboardLayout";

const session = vi.hoisted(() => ({ path: "/", role: "super_admin" }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: { name: "Test", role: session.role }, logout: vi.fn() }),
}));
vi.mock("wouter", () => ({ useLocation: () => [session.path, vi.fn()] }));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

describe("sidebar disclosure and direct license navigation", () => {
  beforeEach(() => {
    session.path = "/";
    session.role = "super_admin";
    vi.stubGlobal("React", React);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  const render = () => renderToStaticMarkup(<DashboardLayout><p>Content</p></DashboardLayout>);

  it("keeps license entries directly visible and collapses the three secondary sections", () => {
    const html = render();
    expect(html).toContain("仪表盘");
    expect(html.match(/data-slot="collapsible-trigger"/g)).toHaveLength(3);
    for (const label of ["生成密钥", "密钥管理", "无合同申请", "生成离线密钥", "离线密钥管理", "密钥验证"]) {
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
});
