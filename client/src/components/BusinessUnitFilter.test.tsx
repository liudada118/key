import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: { contracts: { businessUnits: query } } }));
import { BusinessUnitFilter } from "./BusinessUnitFilter";

beforeEach(() => query.useQuery.mockReturnValue({ data: ["精密事业部", "营销中心"], isLoading: false, isFetching: false, refetch: vi.fn() }));
describe("business unit selector", () => {
  it("shows a labeled native selector with all selected by default", () => {
    const html = renderToStaticMarkup(<BusinessUnitFilter value="" onChange={() => {}} />);
    expect(html).toContain("事业部</label>");
    expect(html).toContain('<option value="" selected="">全部</option>');
    expect(html).toContain('<option value="精密事业部">精密事业部</option>');
  });
  it("preserves the selected filter if it is temporarily absent from refreshed options", () => {
    const html = renderToStaticMarkup(<BusinessUnitFilter value="旧部门" onChange={() => {}} />);
    expect(html).toContain('<option value="旧部门" selected="">旧部门</option>');
  });
  it("reports option failures with an accessible retry control instead of silently clearing the filter", () => {
    query.useQuery.mockReturnValue({ error: new Error("upstream"), isLoading: false, isFetching: false, refetch: vi.fn() });
    const html = renderToStaticMarkup(<BusinessUnitFilter value="精密事业部" onChange={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="重新读取事业部选项"');
    expect(html).toContain('value="精密事业部" selected=""');
  });
});
