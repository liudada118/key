import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ user: { role: "super_admin", isActive: true }, pending: false }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { accounts: { exportOrganization: { useMutation: () => ({ isPending: fixture.pending, mutate: vi.fn() }) } } } }));
import { OrganizationExportButton } from "./OrganizationExportButton";

beforeEach(() => { fixture.user = { role: "super_admin", isActive: true }; fixture.pending = false; });
describe("organization export control", () => {
  it("exposes a single export command for enabled super administrators", () => {
    const html = renderToStaticMarkup(<OrganizationExportButton />);
    expect(html).toContain("一键导出");
    expect(html).toContain('title="导出账号及部门（JSON）"');
  });
  it.each(["user", "admin"])("hides export for %s", role => {
    fixture.user.role = role;
    expect(renderToStaticMarkup(<OrganizationExportButton />)).toBe("");
  });
  it("hides export for disabled super administrators", () => {
    fixture.user.isActive = false;
    expect(renderToStaticMarkup(<OrganizationExportButton />)).toBe("");
  });
  it("disables repeated export while keeping the label and spinner nodes mounted", () => {
    fixture.pending = true;
    const html = renderToStaticMarkup(<OrganizationExportButton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('data-slot="button-spinner"');
    expect(html).toContain("一键导出");
  });
});
