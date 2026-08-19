import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, ButtonSpinner } from "./button";

describe("Button DOM stability", () => {
  it("wraps a text label in a stable element next to a conditional icon", () => {
    const renderButton = (pending: boolean) =>
      renderToStaticMarkup(
        <Button>
          {pending && <svg aria-label="loading" />}
          提交申请
        </Button>,
      );

    expect(renderButton(false)).toContain(
      '<span data-slot="button-label">提交申请</span>',
    );
    expect(renderButton(true)).toContain(
      '<span data-slot="button-label">提交申请</span>',
    );
  });

  it("keeps asChild composition unchanged", () => {
    const html = renderToStaticMarkup(
      <Button asChild>
        <a href="/requests">查看申请</a>
      </Button>,
    );

    expect(html).toContain('<a href="/requests"');
    expect(html).not.toContain('data-slot="button-label"');
  });

  it("keeps the loading icon mounted while pending state changes", () => {
    const renderButton = (pending: boolean) =>
      renderToStaticMarkup(
        <Button>
          <ButtonSpinner pending={pending} />
          <span>直接生成</span>
        </Button>,
      );

    const idleHtml = renderButton(false);
    const pendingHtml = renderButton(true);

    expect(idleHtml).toContain('data-slot="button-spinner"');
    expect(pendingHtml).toContain('data-slot="button-spinner"');
    expect(idleHtml).toContain("<svg");
    expect(pendingHtml).toContain("<svg");
    expect(idleHtml).toContain("hidden");
    expect(pendingHtml).toContain("animate-spin");
  });
});
