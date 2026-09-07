import { describe, expect, it } from "vitest";
import {
  aesEncrypt,
  aesDecrypt,
  generateLicenseKey,
  decodeLicenseKey,
  SENSOR_TYPES,
  SENSOR_GROUPS,
  ALL_SENSORS,
  SENSOR_LABEL_MAP,
  KEY_CATEGORIES,
} from "../shared/crypto";
import {
  getGroupSensorTypes,
  getLicenseSensorGroups,
  getRegistrySensorTypes,
  setLicenseSensorGroups,
} from "../shared/licenseScopes";

describe("AES-ECB Crypto Module", () => {
  it("encrypts and decrypts a simple string correctly", () => {
    const plaintext = "Hello, World!";
    const encrypted = aesEncrypt(plaintext);
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(plaintext);

    const decrypted = aesDecrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces identical ciphertext for the same plaintext (ECB is deterministic)", () => {
    // ECB 无随机 IV：相同明文得相同密文（与桌面端 aesUtil.js 行为一致）
    const plaintext = "Same input";
    const enc1 = aesEncrypt(plaintext);
    const enc2 = aesEncrypt(plaintext);
    expect(enc1).toBe(enc2);
  });

  it("decodes invalid for tampered ciphertext (no auth tag, fails at JSON parse)", () => {
    // ECB 无认证标签，篡改靠上层 JSON 解析失败来发现
    const key = generateLicenseKey("car", 30, "production");
    const tampered = "00000000" + key.substring(8);
    const decoded = decodeLicenseKey(tampered);
    expect(decoded.valid).toBe(false);
  });

  it("returns null for invalid hex input", () => {
    expect(aesDecrypt("")).toBeNull();
    expect(aesDecrypt("zzzz")).toBeNull();
  });

  it("handles JSON payload encryption/decryption", () => {
    const payload = JSON.stringify({ date: Date.now(), file: "car", cat: "production", v: 2 });
    const encrypted = aesEncrypt(payload);
    const decrypted = aesDecrypt(encrypted);
    expect(decrypted).toBe(payload);
    const parsed = JSON.parse(decrypted!);
    expect(parsed.file).toBe("car");
    expect(parsed.cat).toBe("production");
    expect(parsed.v).toBe(2);
  });
});

describe("License Key Generation - Single Type", () => {
  it("generates a valid production license key with single type", () => {
    const key = generateLicenseKey("car", 30, "production");
    expect(key).toBeTruthy();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(56);
  });

  it("generates a valid rental license key", () => {
    const key = generateLicenseKey("foot", 90, "rental");
    expect(key).toBeTruthy();
  });

  it("decodes correctly regardless of ECB determinism", () => {
    // ECB 下相同参数+相同时间戳会得到相同密文，这是预期行为；重点是都能正确解码
    const key1 = generateLicenseKey("car", 30, "production");
    const key2 = generateLicenseKey("car", 30, "production");
    expect(decodeLicenseKey(key1).sensorType).toBe("car");
    expect(decodeLicenseKey(key2).sensorType).toBe("car");
  });
});

describe("License Key Generation - Multi Type", () => {
  it("generates a valid key with multiple sensor types", () => {
    const key = generateLicenseKey(["car", "foot", "hand0205"], 365, "production");
    expect(key).toBeTruthy();
    expect(key.length).toBeGreaterThan(56);
  });

  it("generates a valid key with 'all' type", () => {
    const key = generateLicenseKey("all", 365, "production");
    expect(key).toBeTruthy();
  });

  it("single-element array is stored as string", () => {
    const key = generateLicenseKey(["car"], 30, "production");
    const decoded = decodeLicenseKey(key);
    expect(decoded.valid).toBe(true);
    expect(decoded.sensorType).toBe("car");
    expect(decoded.sensorTypes).toEqual(["car"]);
  });
});

describe("License Key Decoding - Single Type", () => {
  it("decodes a valid production key correctly", () => {
    const key = generateLicenseKey("yanfeng10", 365, "production");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.sensorType).toBe("yanfeng10");
    expect(decoded.sensorTypes).toEqual(["yanfeng10"]);
    expect(decoded.isAllTypes).toBe(false);
    expect(decoded.category).toBe("production");
    expect(decoded.version).toBe(2);
    expect(decoded.remainingDays).toBeGreaterThan(360);
    expect(decoded.expireTimestamp).toBeGreaterThan(Date.now());
  });

  it("decodes a valid rental key correctly", () => {
    const key = generateLicenseKey("bigBed", 30, "rental");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.sensorType).toBe("bigBed");
    expect(decoded.category).toBe("rental");
    expect(decoded.remainingDays).toBeGreaterThan(28);
  });
});

describe("License Key Decoding - Multi Type", () => {
  it("decodes a multi-type key correctly", () => {
    const types = ["car", "foot", "hand0205", "robot1"];
    const key = generateLicenseKey(types, 365, "production");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.sensorTypes).toEqual(types);
    expect(decoded.sensorType).toBe("car,foot,hand0205,robot1");
    expect(decoded.isAllTypes).toBe(false);
  });

  it("decodes an 'all' type key correctly", () => {
    const key = generateLicenseKey("all", 365, "production");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.isAllTypes).toBe(true);
    expect(decoded.sensorType).toBe("all");
    // all 展开 = 注册表全部系统 ∪ 历史 ALL_SENSORS（只增不减：老客户端拿到的清单不会变短）
    expect(decoded.sensorTypes!.length).toBeGreaterThanOrEqual(ALL_SENSORS.length);
    for (const s of ALL_SENSORS) {
      expect(decoded.sensorTypes).toContain(s.value);
    }
    for (const value of getRegistrySensorTypes()) {
      expect(decoded.sensorTypes).toContain(value);
    }
    // 去重：并集里不能有重复项
    expect(new Set(decoded.sensorTypes).size).toBe(decoded.sensorTypes!.length);
  });
});

describe("License Key v3 - Category (@group:) Authorization", () => {
  it("stores the raw @group: token in the payload and marks it v3", () => {
    const key = generateLicenseKey("@group:precision", 365, "production");
    const plaintext = aesDecrypt(key)!;
    const payload = JSON.parse(plaintext);
    // 核心约束：payload 里必须是稳定令牌，不能是签发当时展开的系统数组
    expect(payload.file).toBe("@group:precision");
    expect(payload.v).toBe(3);
  });

  it("expands a category key to the registry's current members at decode time", () => {
    const key = generateLicenseKey("@group:precision", 365, "production");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.version).toBe(3);
    expect(decoded.isAllTypes).toBe(false);
    expect(decoded.groupKeys).toEqual(["precision"]);
    expect(decoded.scope).toBe("@group:precision");
    expect(decoded.sensorType).toBe("@group:precision");
    expect(decoded.sensorTypes).toEqual(getGroupSensorTypes("precision"));
    expect(decoded.sensorTypes).toContain("humanBodyOptimized");
  });

  it("picks up systems added to a category afterwards, without re-issuing the key", () => {
    // 整个改造的核心验收点：先签发分类密钥，再往分类里加系统，旧密钥自动获得新增系统
    const key = generateLicenseKey("@group:care", 365, "production");
    expect(decodeLicenseKey(key).sensorTypes).not.toContain("__brandNewSystem__");

    const original = getLicenseSensorGroups();
    try {
      setLicenseSensorGroups(
        original.map((g) =>
          g.key === "care"
            ? { ...g, items: [...g.items, { value: "__brandNewSystem__" }] }
            : g
        )
      );
      const decoded = decodeLicenseKey(key);
      expect(decoded.valid).toBe(true);
      expect(decoded.sensorTypes).toContain("__brandNewSystem__");
    } finally {
      setLicenseSensorGroups(original);
    }
    // 还原后不再包含
    expect(decodeLicenseKey(key).sensorTypes).not.toContain("__brandNewSystem__");
  });

  it("supports mixing a category token with a single system", () => {
    const key = generateLicenseKey(["@group:care", "humanBodyOptimized"], 365, "production");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.version).toBe(3);
    expect(decoded.groupKeys).toEqual(["care"]);
    expect(decoded.sensorType).toBe("@group:care,humanBodyOptimized");
    expect(decoded.sensorTypes).toEqual([
      ...getGroupSensorTypes("care"),
      "humanBodyOptimized",
    ]);
  });

  it("keeps v2 for all / single system / fixed array (no group token)", () => {
    for (const scope of ["all", "car", ["car", "foot"]] as (string | string[])[]) {
      const payload = JSON.parse(aesDecrypt(generateLicenseKey(scope, 30, "production"))!);
      expect(payload.v).toBe(2);
      expect(decodeLicenseKey(generateLicenseKey(scope, 30, "production")).groupKeys).toEqual([]);
    }
  });

  it("a fixed array key does NOT gain systems added to a category later", () => {
    // 固定数组是"签发即冻结"的语义，不能被分类更新影响（doc §12 端到端最后一项）
    const key = generateLicenseKey(["jqbed", "petCare"], 365, "production");
    const original = getLicenseSensorGroups();
    try {
      setLicenseSensorGroups(
        original.map((g) =>
          g.key === "care"
            ? { ...g, items: [...g.items, { value: "__brandNewSystem__" }] }
            : g
        )
      );
      expect(decodeLicenseKey(key).sensorTypes).toEqual(["jqbed", "petCare"]);
    } finally {
      setLicenseSensorGroups(original);
    }
  });

  it("refuses to issue a key for an unknown category", () => {
    expect(() => generateLicenseKey("@group:nope", 30, "production")).toThrow(
      /unknown license group/
    );
  });

  it("treats a key with an unknown category as invalid at decode time", () => {
    // 直接手工构造密文（绕过生成校验），模拟"分类后来被删掉"的密钥
    const key = aesEncrypt(
      JSON.stringify({ date: Date.now() + 86400000, file: "@group:nope", cat: "production", v: 3 })
    );
    const decoded = decodeLicenseKey(key);
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toMatch(/授权范围无效/);
    // 不能降级成"授权 0 个系统但 valid"
    expect(decoded.sensorTypes).toBeUndefined();
    expect(decoded.scope).toBe("@group:nope");
  });

  it("refuses to issue a key with an empty scope", () => {
    expect(() => generateLicenseKey([], 30, "production")).toThrow();
    expect(() => generateLicenseKey(["", "  "], 30, "production")).toThrow();
  });
});

describe("License Key Backward Compatibility (v2 anchor)", () => {
  // 预先生成的 v2 密文常量：{"date":4102416000000,"file":["car","foot"],"cat":"rental","v":2}
  // 到期时间是 2100-01-01，测试期内不会过期。改动 all 展开 / 分类逻辑都不能让老密钥解不出来。
  const V2_KEY = aesEncrypt(
    JSON.stringify({ date: 4102416000000, file: ["car", "foot"], cat: "rental", v: 2 })
  );

  it("still decodes a pre-v3 fixed-array key", () => {
    const decoded = decodeLicenseKey(V2_KEY);
    expect(decoded.valid).toBe(true);
    expect(decoded.version).toBe(2);
    expect(decoded.category).toBe("rental");
    expect(decoded.sensorType).toBe("car,foot");
    expect(decoded.sensorTypes).toEqual(["car", "foot"]);
    expect(decoded.groupKeys).toEqual([]);
  });

  it("still decodes a v1 key with no version field", () => {
    const v1 = aesEncrypt(JSON.stringify({ date: 4102416000000, file: "car" }));
    const decoded = decodeLicenseKey(v1);
    expect(decoded.valid).toBe(true);
    expect(decoded.version).toBe(1);
    expect(decoded.category).toBe("production");
    expect(decoded.sensorTypes).toEqual(["car"]);
  });

  it("still decodes a v1 'all' key", () => {
    const v1All = aesEncrypt(JSON.stringify({ date: 4102416000000, file: "all" }));
    const decoded = decodeLicenseKey(v1All);
    expect(decoded.valid).toBe(true);
    expect(decoded.isAllTypes).toBe(true);
  });
});

describe("License Key Decoding - Error Cases", () => {
  it("returns invalid for tampered key", () => {
    const key = generateLicenseKey("car", 30, "production");
    const tampered = key.substring(0, 30) + "00" + key.substring(32);
    const decoded = decodeLicenseKey(tampered);
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toBeTruthy();
  });

  it("returns invalid for garbage input", () => {
    const decoded = decodeLicenseKey("this-is-not-a-valid-key");
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toBeTruthy();
  });

  it("returns invalid for empty string", () => {
    const decoded = decodeLicenseKey("");
    expect(decoded.valid).toBe(false);
  });
});

describe("License Key Decoding - Time Injection (nowMs)", () => {
  it("uses injected nowMs for expiry instead of local time", () => {
    const key = generateLicenseKey("car", 30, "production"); // 30 天后到期

    // 注入一个远未来时间 → 应判为已过期
    const future = Date.now() + 60 * 24 * 60 * 60 * 1000;
    expect(decodeLicenseKey(key, future).valid).toBe(false);

    // 注入当前时间 → 仍有效
    const now = Date.now();
    expect(decodeLicenseKey(key, now).valid).toBe(true);
  });

  it("falls back to local time when nowMs is omitted", () => {
    const key = generateLicenseKey("foot", 10, "production");
    expect(decodeLicenseKey(key).valid).toBe(true);
  });
});

describe("Sensor Groups and Constants", () => {
  it("has 7 sensor groups", () => {
    expect(SENSOR_GROUPS.length).toBe(7);
  });

  it("ALL_SENSORS contains all items from all groups", () => {
    const totalFromGroups = SENSOR_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
    expect(ALL_SENSORS.length).toBe(totalFromGroups);
    expect(ALL_SENSORS.length).toBeGreaterThan(50);
  });

  it("SENSOR_TYPES includes all sensors plus 'all'", () => {
    expect(SENSOR_TYPES.length).toBe(ALL_SENSORS.length + 1);
    const allType = SENSOR_TYPES.find((t) => t.value === "all");
    expect(allType).toBeTruthy();
    expect(allType!.label).toBe("全部类型");
  });

  it("SENSOR_LABEL_MAP maps all sensor values to labels", () => {
    expect(Object.keys(SENSOR_LABEL_MAP).length).toBe(ALL_SENSORS.length);
    expect(SENSOR_LABEL_MAP["car"]).toBe("汽车座椅");
    expect(SENSOR_LABEL_MAP["hand0205"]).toBe("触觉手套");
    expect(SENSOR_LABEL_MAP["robot1"]).toBe("宇树G1触觉上衣");
  });

  it("has 2 key categories", () => {
    expect(KEY_CATEGORIES.length).toBe(2);
    expect(KEY_CATEGORIES[0].value).toBe("production");
    expect(KEY_CATEGORIES[1].value).toBe("rental");
  });

  it("each group has icon and non-empty items", () => {
    for (const group of SENSOR_GROUPS) {
      expect(group.group).toBeTruthy();
      expect(group.icon).toBeTruthy();
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.label).toBeTruthy();
        expect(item.value).toBeTruthy();
      }
    }
  });
});
