/**
 * shared/crypto-lib.cjs 与 shared/crypto.ts 的一致性回归。
 *
 * crypto-lib.cjs 是发给 Electron 集成方的自包含副本（内联注册表快照 + 可选的
 * 同目录 licenseSensorGroups.json 覆盖），逻辑与 TS 版是两份实现。
 * 这里锁住两边必须一致的点：密钥互通、分类展开、版本号、注册表内容。
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  aesDecrypt as tsAesDecrypt,
  decodeLicenseKey as tsDecode,
  generateLicenseKey as tsGenerate,
} from "../shared/crypto";
import {
  getGroupSensorTypes,
  getLicenseGroupKeys,
  getRegistrySensorTypes,
} from "../shared/licenseScopes";

const require_ = createRequire(import.meta.url);
const lib = require_("../shared/crypto-lib.cjs");

describe("crypto-lib.cjs ↔ shared/crypto.ts registry parity", () => {
  it("ships the same category keys", () => {
    expect(lib.getLicenseGroupKeys()).toEqual(getLicenseGroupKeys());
  });

  it("ships the same systems, in the same order", () => {
    // 快照落后就会导致老分类密钥在客户端拿不到新增系统 —— 必须逐字一致
    expect(lib.getRegistrySensorTypes()).toEqual(getRegistrySensorTypes());
  });

  it("ships the same members per category", () => {
    for (const key of getLicenseGroupKeys()) {
      expect(lib.getGroupSensorTypes(key), `group ${key} drifted`).toEqual(
        getGroupSensorTypes(key)
      );
    }
  });
});

describe("crypto-lib.cjs ↔ shared/crypto.ts key interop", () => {
  it("decodes a v3 category key issued by the TS side", () => {
    const key = tsGenerate("@group:precision", 365, "production");
    const decoded = lib.decodeLicenseKey(key);
    expect(decoded.valid).toBe(true);
    expect(decoded.version).toBe(3);
    expect(decoded.groupKeys).toEqual(["precision"]);
    expect(decoded.sensorTypes).toEqual(getGroupSensorTypes("precision"));
    expect(decoded.sensorTypes).toContain("humanBodyOptimized");
  });

  it("issues a v3 key the TS side decodes identically", () => {
    const key = lib.generateLicenseKey(["@group:care", "humanBodyOptimized"], 365, "production");
    // payload 里必须是原始令牌，不是展开后的成员
    expect(JSON.parse(tsAesDecrypt(key)!).file).toEqual([
      "@group:care",
      "humanBodyOptimized",
    ]);
    const decoded = tsDecode(key);
    expect(decoded.valid).toBe(true);
    expect(decoded.version).toBe(3);
    expect(decoded.groupKeys).toEqual(["care"]);
    expect(decoded.sensorTypes).toEqual([
      ...getGroupSensorTypes("care"),
      "humanBodyOptimized",
    ]);
  });

  it("keeps v2 for scopes without a category token", () => {
    for (const scope of ["all", "car", ["car", "foot"]] as (string | string[])[]) {
      expect(JSON.parse(lib.aesDecrypt(lib.generateLicenseKey(scope, 30, "production"))).v).toBe(2);
    }
  });

  it("refuses unknown categories at issue time and rejects them at decode time", () => {
    expect(() => lib.generateLicenseKey("@group:nope", 30, "production")).toThrow(
      /unknown license group/
    );
    const forged = lib.aesEncrypt(
      JSON.stringify({ date: Date.now() + 86400000, file: "@group:nope", cat: "production", v: 3 })
    );
    const decoded = lib.decodeLicenseKey(forged);
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toMatch(/授权范围无效/);
    expect(decoded.sensorTypes).toBeUndefined();
  });

  it("expands category keys against the injected registry, not the issue-time snapshot", () => {
    // 集成方同步一份新注册表过来（setLicenseSensorGroups 就是这个注入口）
    const key = lib.generateLicenseKey("@group:care", 365, "production");
    const original = lib.getLicenseSensorGroups();
    try {
      lib.setLicenseSensorGroups(
        original.map((g: { key: string; items: { value: string }[] }) =>
          g.key === "care" ? { ...g, items: [...g.items, { value: "__added__" }] } : g
        )
      );
      expect(lib.decodeLicenseKey(key).sensorTypes).toContain("__added__");
    } finally {
      lib.setLicenseSensorGroups(original);
    }
    expect(lib.decodeLicenseKey(key).sensorTypes).not.toContain("__added__");
  });
});
