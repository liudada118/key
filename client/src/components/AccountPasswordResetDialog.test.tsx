import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountPasswordResetDialog, { passwordResetSuccessMessage } from "./AccountPasswordResetDialog";

const fixture = vi.hoisted(() => ({ changeOpen: undefined as ((open: boolean) => void) | undefined }));
vi.mock("@/components/ui/dialog", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/dialog")>(),
  Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) => {
    fixture.changeOpen = onOpenChange;
    return open ? <div>{children}</div> : null;
  },
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
}));

const target = { id: 12, username: "local-user", name: "本地测试", isActive: false };
const actions = { onOpenChange: vi.fn(), onPasswordChange: vi.fn(), onSubmit: vi.fn() };
const render = (options: { active?: boolean; password?: string; pending?: boolean } = {}) => renderToStaticMarkup(
  <AccountPasswordResetDialog {...actions} open target={{ ...target, isActive: options.active ?? false }}
    password={options.password ?? "local-test-password"} pending={options.pending ?? false} />,
);

beforeEach(() => vi.clearAllMocks());

describe("password reset account status", () => {
  it("warns that a disabled account will still be unable to sign in", () => {
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain("重置密码不会自动启用账号");
    expect(html).toContain("开启“启用状态”后才能登录");
    expect(html).toContain("local-user");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    const inputId = html.match(/<input[^>]*id="([^"]+)"/)![1];
    expect(html).toContain(`for="${inputId}"`);
    expect(html).toContain('aria-describedby=');
  });

  it("does not warn that an enabled account is disabled", () => {
    expect(render({ active: true })).not.toContain("该账号已禁用");
  });

  it("distinguishes a password reset from enabling an account in the success feedback", () => {
    expect(passwordResetSuccessMessage(false)).toContain("账号仍被禁用");
    expect(passwordResetSuccessMessage(false)).toContain("启用后登录");
    expect(passwordResetSuccessMessage(true)).toBe("密码重置成功");
    expect(passwordResetSuccessMessage()).toBe("密码重置成功");
  });

  it.each(["", "12345", "      "])("prevents submission of an invalid password (%s)", password => {
    expect(render({ password })).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(actions.onSubmit).not.toHaveBeenCalled();
  });

  it("allows a valid password without silently enabling the account", () => {
    const html = render();
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).not.toContain('role="switch"');
    expect(actions.onSubmit).not.toHaveBeenCalled();
  });

  it("keeps pending controls stable and blocks dismissal during the reset", () => {
    const html = render({ pending: true });
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain('data-slot="button-spinner"');
    fixture.changeOpen!(false);
    expect(actions.onOpenChange).not.toHaveBeenCalled();
  });

  it("permits dismissal when idle", () => {
    render();
    fixture.changeOpen!(false);
    expect(actions.onOpenChange).toHaveBeenCalledWith(false);
  });
});
