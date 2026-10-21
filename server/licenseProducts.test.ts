import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { aesDecrypt, aesEncrypt, decodeLicenseKey, generateLicenseKey } from "../shared/crypto";
import { licenseSdkFeatures, normalizeLicenseProduct } from "../shared/licenseProducts";
import { prepareOnlineKeyGeneration } from "./onlineKeyGeneration";
import { createOfflineLicensePayload } from "./offlineLicensePayload";

const desktopLibrary = createRequire(import.meta.url)("../shared/crypto-lib.cjs");

describe("product-bound issuance", () => {
  it("defaults historical payloads exclusively to desktop", () => {
    const key = aesEncrypt(JSON.stringify({ date: Date.now() + 86400000, file: "all" }));
    expect(decodeLicenseKey(key)).toMatchObject({ valid: true, productType: "shroom-desktop" });
    expect(normalizeLicenseProduct(undefined)).toBe("shroom-desktop");
    expect(() => normalizeLicenseProduct("anything")).toThrow();
  });

  it("puts SDK scope in a field legacy desktop libraries cannot consume", () => {
    const key = generateLicenseKey("all", 3, "rental", "shroom-sdk");
    const payload = JSON.parse(aesDecrypt(key)!);
    expect(payload).toMatchObject({ productType: "shroom-sdk", sdkFile: "all", cat: "rental" });
    expect(payload.file).toBeUndefined();
    expect(decodeLicenseKey(key)).toMatchObject({ valid: true, productType: "shroom-sdk", isAllTypes: true });
    expect(desktopLibrary.decodeLicenseKey(key).valid).toBe(false);
  });

  it("preserves the product across batch generation and database records", () => {
    const result = prepareOnlineKeyGeneration({ mode: "batch", productType: "shroom-sdk", sensorTypes: "hand",
      days: 3, category: "production", count: 2, createdById: 1, createdByName: "test" });
    expect(result.records).toHaveLength(2);
    for (const record of result.records) {
      expect(record.productType).toBe("shroom-sdk");
      expect(record.sensorType).toBe("all");
      expect(decodeLicenseKey(record.keyString)).toMatchObject({ productType: "shroom-sdk", isAllTypes: true, scope: "all" });
      expect(JSON.parse(aesDecrypt(record.keyString)!)).toMatchObject({ sdkFile: "all" });
    }
  });

  it.each(["hand", "@group:precision", "@group:retired", "all"])("signs all-model SDK offline access without desktop sensorTypes (%s)", scope => {
    const result = createOfflineLicensePayload({ productType: "shroom-sdk", sensorTypes: scope,
      deviceLimit: 0, expireDate: Date.now() + 86400000, issuedAt: Date.now() });
    expect(result.payload).toMatchObject({ productType: "shroom-sdk", version: 5, deviceLimit: 0 });
    expect(result.payload.sensorTypes).toBeUndefined();
    expect(result.scope).toBe("all");
    expect(result.payload.boundSensorTypes).toBe("all");
    expect(result.payload.sdkFeatures).toEqual(["serial", "stream", "recording", "serial.raw"]);
  });

  it("keeps legacy desktop offline formats and device-limit semantics", () => {
    const base = { sensorTypes: ["hand"], expireDate: Date.now() + 86400000, issuedAt: Date.now() };
    expect(createOfflineLicensePayload({ ...base, deviceLimit: 0 }).payload).toMatchObject({
      sensorTypes: "hand", version: 2,
    });
    expect(createOfflineLicensePayload({ ...base, deviceLimit: 2 }).payload).toMatchObject({
      boundSensorTypes: "hand", deviceLimit: 2, version: 4,
    });
    expect(licenseSdkFeatures("shroom-desktop")).toEqual([]);
  });

  it.each(["hand", "@group:retired", ["hand", "handGloveFullPacket"]])("interprets historical SDK model scopes as all models (%s)", scope => {
    const key = aesEncrypt(JSON.stringify({ productType: "shroom-sdk", sdkFile: scope, date: Date.now() + 86400000 }));
    expect(decodeLicenseKey(key)).toMatchObject({ valid: true, productType: "shroom-sdk", sensorType: "all",
      sensorTypes: ["all"], isAllTypes: true, scope: "all", groupKeys: [] });
    expect(desktopLibrary.decodeLicenseKey(key).valid).toBe(false);
  });

  it.each([{}, [], [""], 7])("rejects malformed SDK scope fields (%s)", scope => {
    const key = aesEncrypt(JSON.stringify({ productType: "shroom-sdk", sdkFile: scope, date: Date.now() + 86400000 }));
    expect(decodeLicenseKey(key).valid).toBe(false);
  });
});
