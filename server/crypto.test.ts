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
    expect(decoded.sensorTypes!.length).toBe(ALL_SENSORS.length);
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
