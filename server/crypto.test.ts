import { describe, expect, it } from "vitest";
import {
  aesEncrypt,
  aesDecrypt,
  generateLicenseKey,
  decodeLicenseKey,
  SENSOR_TYPES,
  KEY_CATEGORIES,
} from "../shared/crypto";

describe("AES-256-GCM Crypto Module", () => {
  it("encrypts and decrypts a simple string correctly", () => {
    const plaintext = "Hello, World!";
    const encrypted = aesEncrypt(plaintext);
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(plaintext);

    const decrypted = aesDecrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const plaintext = "Same input";
    const enc1 = aesEncrypt(plaintext);
    const enc2 = aesEncrypt(plaintext);
    expect(enc1).not.toBe(enc2); // Random IV makes each encryption unique
  });

  it("returns null for tampered ciphertext", () => {
    const encrypted = aesEncrypt("test data");
    // Tamper with the auth tag portion (chars 24-56)
    const tampered =
      encrypted.substring(0, 30) +
      "ff" +
      encrypted.substring(32);
    const result = aesDecrypt(tampered);
    expect(result).toBeNull();
  });

  it("returns null for invalid hex input", () => {
    expect(aesDecrypt("")).toBeNull();
    expect(aesDecrypt("abc")).toBeNull();
    expect(aesDecrypt("not-valid-hex-at-all")).toBeNull();
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

describe("License Key Generation", () => {
  it("generates a valid production license key", () => {
    const key = generateLicenseKey("car", 30, "production");
    expect(key).toBeTruthy();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(56); // iv(24) + tag(32) + ciphertext
  });

  it("generates a valid rental license key", () => {
    const key = generateLicenseKey("foot", 90, "rental");
    expect(key).toBeTruthy();
  });

  it("generates unique keys for same parameters", () => {
    const key1 = generateLicenseKey("car", 30, "production");
    const key2 = generateLicenseKey("car", 30, "production");
    expect(key1).not.toBe(key2);
  });
});

describe("License Key Decoding", () => {
  it("decodes a valid production key correctly", () => {
    const key = generateLicenseKey("yanfeng10", 365, "production");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.sensorType).toBe("yanfeng10");
    expect(decoded.category).toBe("production");
    expect(decoded.version).toBe(2);
    expect(decoded.remainingDays).toBeGreaterThan(360);
    expect(decoded.expireTimestamp).toBeGreaterThan(Date.now());
  });

  it("decodes a valid rental key correctly", () => {
    const key = generateLicenseKey("sit", 30, "rental");
    const decoded = decodeLicenseKey(key);

    expect(decoded.valid).toBe(true);
    expect(decoded.sensorType).toBe("sit");
    expect(decoded.category).toBe("rental");
    expect(decoded.remainingDays).toBeGreaterThan(28);
  });

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

describe("Constants", () => {
  it("has 14 sensor types including 'all'", () => {
    expect(SENSOR_TYPES.length).toBe(14);
    const allType = SENSOR_TYPES.find((t) => t.value === "all");
    expect(allType).toBeTruthy();
    expect(allType!.label).toBe("全部类型");
  });

  it("has 2 key categories", () => {
    expect(KEY_CATEGORIES.length).toBe(2);
    expect(KEY_CATEGORIES[0].value).toBe("production");
    expect(KEY_CATEGORIES[1].value).toBe("rental");
  });
});
