import { afterEach, describe, expect, it } from "vitest";
import {
  GROUP_SCOPE_PREFIX,
  LICENSE_GROUP_META,
  buildLicenseFile,
  containsGroupScopeToken,
  createGroupScopeToken,
  expandLicenseFile,
  formatLicenseScope,
  formatScopeEntry,
  getGroupSensorTypes,
  getLicenseGroupKeys,
  getLicenseGroupOptions,
  getLicenseSensorGroups,
  getRegistrySensorTypes,
  groupKeyByDbGroupName,
  groupScopeLabel,
  isGroupScopeToken,
  normalizeLicenseFile,
  parseGroupScopeToken,
  setLicenseSensorGroups,
  validateLicenseSensorGroups,
} from "../shared/licenseScopes";

const PRISTINE = getLicenseSensorGroups();

// 任何用 setLicenseSensorGroups 换过注册表的用例都要还原，否则污染后续用例
afterEach(() => setLicenseSensorGroups(PRISTINE));

describe("Registry validation (fail-fast)", () => {
  it("accepts the bundled registry and reports its counts", () => {
    const counts = validateLicenseSensorGroups(PRISTINE);
    expect(counts.groupCount).toBe(PRISTINE.length);
    expect(counts.sensorTypeCount).toBe(getRegistrySensorTypes().length);
    expect(counts.groupCount).toBeGreaterThan(0);
    expect(counts.sensorTypeCount).toBeGreaterThan(0);
  });

  it("rejects a non-array or empty registry", () => {
    expect(() => validateLicenseSensorGroups(undefined)).toThrow(/non-empty array/);
    expect(() => validateLicenseSensorGroups({})).toThrow(/non-empty array/);
    expect(() => validateLicenseSensorGroups([])).toThrow(/non-empty array/);
  });

  it("rejects duplicate group keys", () => {
    expect(() =>
      validateLicenseSensorGroups([
        { key: "care", items: [{ value: "a" }] },
        { key: "care", items: [{ value: "b" }] },
      ])
    ).toThrow(/duplicate or invalid license group: care/);
  });

  it("rejects a missing or blank group key", () => {
    expect(() => validateLicenseSensorGroups([{ items: [{ value: "a" }] }])).toThrow(
      /duplicate or invalid license group/
    );
    expect(() =>
      validateLicenseSensorGroups([{ key: "   ", items: [{ value: "a" }] }])
    ).toThrow(/duplicate or invalid license group/);
  });

  it("rejects a group with no display systems", () => {
    expect(() => validateLicenseSensorGroups([{ key: "care", items: [] }])).toThrow(
      /no display systems: care/
    );
    expect(() => validateLicenseSensorGroups([{ key: "care" }])).toThrow(
      /no display systems: care/
    );
  });

  it("rejects a system value duplicated across groups", () => {
    expect(() =>
      validateLicenseSensorGroups([
        { key: "care", items: [{ value: "jqbed" }] },
        { key: "lab", items: [{ value: "jqbed" }] },
      ])
    ).toThrow(/duplicate or invalid display system: jqbed/);
  });

  it("leaves the active registry untouched when the replacement is invalid", () => {
    const before = getRegistrySensorTypes();
    expect(() => setLicenseSensorGroups([{ key: "x", items: [] }])).toThrow();
    expect(getRegistrySensorTypes()).toEqual(before);
  });
});

describe("Registry accessors", () => {
  it("exposes group keys in registry order", () => {
    expect(getLicenseGroupKeys()).toEqual(PRISTINE.map((g) => g.key));
  });

  it("flattens systems in registry order without duplicates", () => {
    const flat = getRegistrySensorTypes();
    expect(flat).toEqual(PRISTINE.flatMap((g) => g.items.map((i) => i.value)));
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("returns a group's members, and [] for an unknown group", () => {
    expect(getGroupSensorTypes("precision")).toContain("humanBodyOptimized");
    expect(getGroupSensorTypes("nope")).toEqual([]);
    expect(getGroupSensorTypes("")).toEqual([]);
  });

  it("has display metadata for every group in the registry", () => {
    // dbGroupName 必须与 sensorTypes.groupName 逐字一致，缺一个就会让部门绑定失效
    for (const group of PRISTINE) {
      expect(LICENSE_GROUP_META[group.key], `missing meta for ${group.key}`).toBeTruthy();
      expect(groupKeyByDbGroupName(LICENSE_GROUP_META[group.key].dbGroupName)).toBe(group.key);
    }
    expect(groupKeyByDbGroupName("不存在的分组")).toBeUndefined();
  });

  it("builds UI options with token + labels for every group", () => {
    const options = getLicenseGroupOptions();
    expect(options.length).toBe(PRISTINE.length);
    const precision = options.find((o) => o.key === "precision")!;
    expect(precision.token).toBe("@group:precision");
    expect(precision.scopeLabel).toBe("精密全部");
    expect(precision.dbGroupName).toBe("精密");
    expect(precision.sensorTypes).toEqual(getGroupSensorTypes("precision"));
  });
});

describe("Group scope tokens", () => {
  it("creates a token for a known group", () => {
    expect(createGroupScopeToken("precision")).toBe(`${GROUP_SCOPE_PREFIX}precision`);
    expect(createGroupScopeToken("  care  ")).toBe("@group:care");
  });

  it("refuses to create a token for an unknown group", () => {
    expect(() => createGroupScopeToken("nope")).toThrow(/unknown license group: nope/);
    expect(() => createGroupScopeToken("")).toThrow(/unknown license group/);
  });

  it("detects tokens by prefix only (display layer must not throw)", () => {
    expect(isGroupScopeToken("@group:precision")).toBe(true);
    expect(isGroupScopeToken("  @group:nope  ")).toBe(true);
    expect(isGroupScopeToken("hand0205")).toBe(false);
    expect(isGroupScopeToken("all")).toBe(false);
    expect(isGroupScopeToken(undefined)).toBe(false);
    expect(isGroupScopeToken(123)).toBe(false);
  });

  it("parses a token, and throws rather than degrading an unknown group", () => {
    expect(parseGroupScopeToken("@group:precision")).toBe("precision");
    expect(parseGroupScopeToken("hand0205")).toBeNull();
    expect(parseGroupScopeToken("all")).toBeNull();
    // 未知分类绝不能被当成一个普通系统 key —— 否则等于授权了一个不存在的系统
    expect(() => parseGroupScopeToken("@group:nope")).toThrow(/unknown license group: nope/);
  });

  it("decides the payload version (v2 vs v3)", () => {
    expect(containsGroupScopeToken("all")).toBe(false);
    expect(containsGroupScopeToken("hand0205")).toBe(false);
    expect(containsGroupScopeToken(["hand0205", "humanBodyOptimized"])).toBe(false);
    expect(containsGroupScopeToken("@group:precision")).toBe(true);
    expect(containsGroupScopeToken(["@group:care", "humanBodyOptimized"])).toBe(true);
  });
});

describe("expandLicenseFile - the 5 supported scope shapes", () => {
  it('"all" → isAllTypes with the full list', () => {
    const r = expandLicenseFile("all");
    expect(r.isAllTypes).toBe(true);
    expect(r.groupKeys).toEqual([]);
    expect(r.sensorTypes).toEqual(getRegistrySensorTypes());
  });

  it('"all" uses the caller-supplied full list when given', () => {
    const r = expandLicenseFile("all", { allSensorTypes: ["a", "b", "a", ""] });
    expect(r.isAllTypes).toBe(true);
    expect(r.sensorTypes).toEqual(["a", "b"]); // 去空 + 去重
  });

  it("single system → itself", () => {
    const r = expandLicenseFile("humanBodyOptimized");
    expect(r).toEqual({
      isAllTypes: false,
      groupKeys: [],
      sensorTypes: ["humanBodyOptimized"],
    });
  });

  it("fixed array → itself, order preserved (frozen at issue time)", () => {
    const r = expandLicenseFile(["hand0205", "humanBodyOptimized"]);
    expect(r.groupKeys).toEqual([]);
    expect(r.sensorTypes).toEqual(["hand0205", "humanBodyOptimized"]);
  });

  it("category token → the group's current members", () => {
    const r = expandLicenseFile("@group:precision");
    expect(r.isAllTypes).toBe(false);
    expect(r.groupKeys).toEqual(["precision"]);
    expect(r.sensorTypes).toEqual(getGroupSensorTypes("precision"));
  });

  it("mixed category + system → category members first, then the extra system", () => {
    const r = expandLicenseFile(["@group:care", "humanBodyOptimized"]);
    expect(r.groupKeys).toEqual(["care"]);
    expect(r.sensorTypes).toEqual([...getGroupSensorTypes("care"), "humanBodyOptimized"]);
  });

  it("keeps request order and dedupes across groups and systems", () => {
    const r = expandLicenseFile([
      "jqbed", // 也是 care 的成员
      "@group:care",
      "@group:care", // 重复分类
      "petCare", // 已被 care 覆盖
      "hand0205",
    ]);
    expect(r.groupKeys).toEqual(["care"]);
    // jqbed 先出现就排在最前，care 的其余成员按注册表顺序补齐，重复项不再出现
    expect(r.sensorTypes[0]).toBe("jqbed");
    expect(new Set(r.sensorTypes).size).toBe(r.sensorTypes.length);
    for (const value of getGroupSensorTypes("care")) {
      expect(r.sensorTypes).toContain(value);
    }
    expect(r.sensorTypes).toContain("hand0205");
  });

  it("skips blank / non-string entries", () => {
    const r = expandLicenseFile(["", "  ", null, 42, "hand0205"] as unknown[]);
    expect(r.sensorTypes).toEqual(["hand0205"]);
  });

  it("throws on an unknown category", () => {
    expect(() => expandLicenseFile("@group:nope")).toThrow(/unknown license group: nope/);
    expect(() => expandLicenseFile(["hand0205", "@group:nope"])).toThrow(
      /unknown license group: nope/
    );
  });

  it("throws when the scope expands to nothing", () => {
    expect(() => expandLicenseFile([])).toThrow(/no display system/);
    expect(() => expandLicenseFile(["", "  "])).toThrow(/no display system/);
  });

  it("follows the registry, not the issue-time snapshot", () => {
    // 核心语义：分类密钥的成员在解码时才确定
    const before = expandLicenseFile("@group:care").sensorTypes;
    setLicenseSensorGroups(
      PRISTINE.map((g) =>
        g.key === "care" ? { ...g, items: [...g.items, { value: "__added__" }] } : g
      )
    );
    const after = expandLicenseFile("@group:care").sensorTypes;
    expect(after).toEqual([...before, "__added__"]);
  });
});

describe("buildLicenseFile (doc §5.2)", () => {
  it('scopeType "all" → "all"', () => {
    expect(buildLicenseFile({ scopeType: "all" })).toBe("all");
  });

  it('scopeType "group" → a single token string', () => {
    expect(buildLicenseFile({ scopeType: "group", groupKey: "precision" })).toBe(
      "@group:precision"
    );
  });

  it('scopeType "groups" → token array', () => {
    expect(buildLicenseFile({ scopeType: "groups", groupKeys: ["care", "lab"] })).toEqual([
      "@group:care",
      "@group:lab",
    ]);
  });

  it('scopeType "systems" → the systems, single one downgraded to string', () => {
    expect(buildLicenseFile({ scopeType: "systems", sensorTypes: ["hand0205"] })).toBe(
      "hand0205"
    );
    expect(
      buildLicenseFile({ scopeType: "systems", sensorTypes: ["hand0205", "humanBody"] })
    ).toEqual(["hand0205", "humanBody"]);
  });

  it('scopeType "mixed" → tokens first, then systems', () => {
    expect(
      buildLicenseFile({
        scopeType: "mixed",
        groupKeys: ["care"],
        sensorTypes: ["humanBodyOptimized"],
      })
    ).toEqual(["@group:care", "humanBodyOptimized"]);
  });

  it("rejects unknown groups and empty scopes", () => {
    expect(() => buildLicenseFile({ scopeType: "group", groupKey: "nope" })).toThrow(
      /unknown license group/
    );
    expect(() => buildLicenseFile({ scopeType: "systems", sensorTypes: [] })).toThrow(
      /no display system/
    );
  });
});

describe("normalizeLicenseFile", () => {
  it('passes "all" through', () => {
    expect(normalizeLicenseFile("all")).toBe("all");
  });

  it("trims, dedupes, preserves order, and downgrades a single entry to string", () => {
    expect(normalizeLicenseFile([" hand0205 ", "hand0205", "", "humanBody"])).toEqual([
      "hand0205",
      "humanBody",
    ]);
    expect(normalizeLicenseFile(["  hand0205  "])).toBe("hand0205");
    expect(normalizeLicenseFile("hand0205")).toBe("hand0205");
  });

  it("keeps category tokens raw (never expands them)", () => {
    // 这是整套机制的前提：写进密钥 payload 的必须是令牌本身
    expect(normalizeLicenseFile(["@group:precision"])).toBe("@group:precision");
    expect(normalizeLicenseFile(["@group:care", "humanBodyOptimized"])).toEqual([
      "@group:care",
      "humanBodyOptimized",
    ]);
  });

  it("validates: unknown category and empty scope are rejected", () => {
    expect(() => normalizeLicenseFile("@group:nope")).toThrow(/unknown license group/);
    expect(() => normalizeLicenseFile([])).toThrow(/no display system/);
    expect(() => normalizeLicenseFile(["  "])).toThrow(/no display system/);
  });
});

describe("Display helpers", () => {
  it("labels a category token in Chinese", () => {
    expect(groupScopeLabel("@group:precision")).toBe("精密全部");
    expect(groupScopeLabel("@group:care")).toBe("关怀全部");
    // 未知分类不抛错（展示层要容错），回退成 "<key>全部"
    expect(groupScopeLabel("@group:nope")).toBe("nope全部");
  });

  it("formats a single scope entry", () => {
    expect(formatScopeEntry("all")).toBe("全部传感器");
    expect(formatScopeEntry("@group:precision")).toBe("精密全部");
    expect(formatScopeEntry("humanBodyOptimized")).toBe("人体全身优化");
    expect(formatScopeEntry("unknownSystem")).toBe("unknownSystem");
    expect(formatScopeEntry("")).toBe("");
    // 传入的 labelMap（后台读 DB 的传感器名）优先于内置中文名
    expect(formatScopeEntry("hand0205", { hand0205: "库里的名字" })).toBe("库里的名字");
  });

  it("formats a whole scope, splitting comma strings", () => {
    expect(formatLicenseScope("all")).toBe("全部传感器");
    expect(formatLicenseScope("@group:precision,humanBodyOptimized")).toBe(
      "精密全部、人体全身优化"
    );
    expect(formatLicenseScope(["@group:care", "humanBodyOptimized"])).toBe(
      "关怀全部、人体全身优化"
    );
    expect(formatLicenseScope(null)).toBe("");
    expect(formatLicenseScope(undefined)).toBe("");
    expect(formatLicenseScope("")).toBe("");
  });
});
