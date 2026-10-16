import { describe, expect, it } from "vitest";
import { collectContractBusinessUnits, filterContractsByBusinessUnit } from "./feishuContractDirectory";

describe("business unit filter semantics", () => {
  const items = [{ businessUnit: "Ａ部 " }, { businessUnit: "a部" }, { businessUnit: "乙部" }, { businessUnit: null }];
  it("deduplicates department labels without manufacturing an unassigned department", () => {
    expect(collectContractBusinessUnits(items)).toHaveLength(2);
    expect(collectContractBusinessUnits(items)).toContain("Ａ部");
  });
  it("matches normalized full names and keeps unassigned contracts only in all", () => {
    expect(filterContractsByBusinessUnit(items, "a部")).toEqual(items.slice(0, 2));
    expect(filterContractsByBusinessUnit(items)).toBe(items);
    expect(filterContractsByBusinessUnit(items, "部")).toEqual([]);
    expect(items[0].businessUnit).toBe("Ａ部 ");
  });
});
