import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  query: vi.fn(), refetch: vi.fn(), select: undefined as undefined | ((value: string) => void),
}));
vi.mock("@/lib/trpc", () => ({ trpc: { keys: { creators: { useQuery: fixture.query } } } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) => {
    fixture.select = onValueChange;
    return <div>{children}</div>;
  },
  SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, disabled }: { children: React.ReactNode; value: string; disabled?: boolean }) =>
    <option value={value} disabled={disabled}>{children}</option>,
}));

import KeyCreatorSelect from "./KeyCreatorSelect";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  fixture.query.mockReturnValue({ data: [
    { id: 7, name: "同名人员", username: "issuer-a" },
    { id: 8, name: "同名人员", username: "issuer-b" },
    { id: 9, name: "历史账号", username: null },
  ], isLoading: false, isError: false, refetch: fixture.refetch });
});

describe("key creator filter", () => {
  it.each(["online", "offline"] as const)("requests scoped %s creators with the active category", keyType => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<KeyCreatorSelect keyType={keyType} deviceMode="limited" value="__all__" onChange={onChange} />);
    expect(fixture.query).toHaveBeenCalledWith({ keyType, deviceMode: "limited" });
    expect(html).toContain('aria-label="按生成人员筛选"');
    expect(html).toContain("全部人员");
    expect(html).toContain("同名人员 (issuer-a)");
    expect(html).toContain("同名人员 (issuer-b)");
    expect(html).toContain("历史账号 (#9)");
    fixture.select!("8");
    fixture.select!("__all__");
    expect(onChange.mock.calls).toEqual([["8"], ["__all__"]]);
  });

  it("does not turn loading or errors into selectable creator IDs", () => {
    fixture.query.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    expect(renderToStaticMarkup(<KeyCreatorSelect keyType="online" deviceMode="unlimited" value="__all__" onChange={vi.fn()} />))
      .toContain('<option value="__loading__" disabled="">');
    fixture.query.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: fixture.refetch });
    const html = renderToStaticMarkup(<KeyCreatorSelect keyType="online" deviceMode="unlimited" value="__all__" onChange={vi.fn()} />);
    expect(html).toContain('<option value="__error__" disabled="">');
    expect(html).toContain('aria-label="重新加载生成人员"');
    expect(html).toContain('value="__all__"');
  });
});
