import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, username: "employee", role: "super_admin" } }) }));
import AlgorithmPlatform, { algorithmProductInput, parseAlgorithmAmount, type AlgorithmWorkspace } from "./AlgorithmPlatform";

describe("算法平台人工交易工作台", () => {
  it("金额转换保留十进制精度并拒绝负数、指数、第三位小数", () => {
    expect(parseAlgorithmAmount("0")).toBe(0);
    expect(parseAlgorithmAmount("19.9")).toBe(1990);
    expect(parseAlgorithmAmount("0.29")).toBe(29);
    expect(parseAlgorithmAmount("123.45")).toBe(12345);
    for (const value of ["-1", "1.001", "1e3", "01.00", "NaN", "", "99999999999"]) expect(() => parseAlgorithmAmount(value)).toThrow();
  });

  it("提交只包含公开商品声明，不携带任意字段、源码或模型", () => {
    const product = algorithmProductInput({ id: " posture ", name: "姿态", summary: "识别坐姿", task: "区分动作", deliveryType: "local", sellerName: "供给团队", sellerKind: "invited",
      version: "1.0.0", packageId: " local-pkg ", matrixTotals: "529，1024", sensorTypes: "seatpad, hand", inputs: "映射后读数", outputs: "类别", evidence: "独立记录验证", limitations: "限本型号", support: "联系交付人",
      source: "private source", model: "private weights", licenseKey: "private key" });
    expect(product.id).toBe("posture");
    expect(product.packageId).toBe("local-pkg");
    expect(product.compatibility.matrixTotals).toEqual([529, 1024]);
    expect(product.compatibility.sensorTypes).toEqual(["seatpad", "hand"]);
    expect(JSON.stringify(product)).not.toContain("private");
    expect(product.pricing.mode).toBe("manual_quote");
  });

  it("初始页面不虚构商品，不在读取成功前授予审核或财务动作", () => {
    vi.stubGlobal("React", React);
    const workspace: AlgorithmWorkspace = { submissions: [], requests: [], orders: [], customers: [], capabilities: { review: false, finance: false } };
    const html = renderToStaticMarkup(<AlgorithmPlatform initialWorkspace={workspace} />);
    expect(html).toContain("算法平台");
    expect(html).toContain("暂无提交");
    expect(html).toContain("提交审核");
    expect(html).not.toContain("确认收到款项");
    expect(html).not.toContain("审核发布");
  });

  it("自身提交版本即使具有审核资格也要求另一人复核", () => {
    const workspace: AlgorithmWorkspace = { submissions: [{ id: 1, status: "pending", submittedById: 7,
      product: { id: "test", name: "待审商品", summary: "摘要", task: "任务", deliveryType: "local", seller: { name: "自营", kind: "self" },
        version: "1.0.0", packageId: null, compatibility: { matrixTotals: [], sensorTypes: [] }, inputs: "输入", outputs: "输出", evidence: "证据", limitations: "限制", support: "支持", pricing: { mode: "manual_quote" } } }],
      requests: [], orders: [], customers: [], capabilities: { review: true, finance: false } };
    const html = renderToStaticMarkup(<AlgorithmPlatform initialWorkspace={workspace} />);
    expect(html).toContain("请由另一位有审核权限的人员复核");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?审核发布/);
  });
});
