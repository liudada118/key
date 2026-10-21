import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aesEncrypt, generateLicenseKey } from "../shared/crypto";
import { getGroupSensorTypes, getLicenseGroupKeys } from "../shared/licenseScopes";
import { verifyOfflineClientKey, verifyOnlineClientKey } from "./systemPackageClientLicense";

/** Issue a test-only offline code with the same RSA-SHA256 envelope as production. */
function fixture(scope: string[] | "all" = ["seatpad"], deviceLimit = 0) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const expireDate = Date.now() + 3600000;
  const payload = Buffer.from(JSON.stringify({ ...(deviceLimit ? { boundSensorTypes: scope, deviceLimit } : { sensorTypes: scope }), expireDate, issuedAt: Date.now(), version: deviceLimit ? 4 : 2 })).toString("base64");
  const signer = createSign("RSA-SHA256");
  signer.update(payload);
  signer.end();
  const activationCode = Buffer.from(JSON.stringify({ payload, signature: signer.sign(privateKey, "base64") })).toString("base64");
  return { activationCode, record: { activationCode, status: "ISSUED", isDeleted: false,
    customerId: 42, customerActive: true, expireDate, publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() } };
}

describe("offline key access to company system packages", () => {
  it("grants only the signed scope while preserving optional customer metadata", () => {
    const { activationCode, record } = fixture(["seatpad"]);
    expect(verifyOfflineClientKey(activationCode, record)).toMatchObject({ grant: { customerId: 42, scope: ["seatpad"] } });
    expect(verifyOfflineClientKey(activationCode, record).grant?.expiresAt).toBe(record.expireDate);
  });

  it("allows all systems only for an all-scope key", () => {
    const { activationCode, record } = fixture("all");
    expect(verifyOfflineClientKey(activationCode, record).grant?.scope).toBe("all");
  });

  it("does not grant desktop delivery from an SDK product record", () => {
    const { activationCode, record } = fixture("all");
    expect(verifyOfflineClientKey(activationCode, { ...record, productType: "shroom-sdk" }).error).toBe("PRODUCT_MISMATCH");
  });

  it("accepts the RSA-signed scope of a device-limited version 4 key", () => {
    const { activationCode, record } = fixture(["seatpad"], 2);
    expect(verifyOfflineClientKey(activationCode, record)).toMatchObject({ grant: { customerId: 42, scope: ["seatpad"] } });
  });

  it("grants a signed company system without customer association or active customer metadata", () => {
    const { activationCode, record } = fixture();
    expect(verifyOfflineClientKey(activationCode, { ...record, customerId: null }).grant)
      .toMatchObject({ customerId: null, scope: ["seatpad"] });
    const inactiveCustomer = { ...record, customerActive: false };
    expect(verifyOfflineClientKey(activationCode, inactiveCustomer).grant?.scope).toEqual(["seatpad"]);
  });

  it("expands registered groups without including unrelated company systems", () => {
    const group = getLicenseGroupKeys()[0];
    const { activationCode, record } = fixture([`@group:${group}`]);
    const result = verifyOfflineClientKey(activationCode, record);
    expect(result.grant?.scope).toEqual(getGroupSensorTypes(group));
    expect(result.grant?.scope).not.toContain("seatpad");
    const invalid = fixture(["@group:unregistered-test-group"]);
    expect(verifyOfflineClientKey(invalid.activationCode, invalid.record).error).toBe("LICENSE_INVALID");
  });

  it("rejects inactive status, expiry, and mismatched records", () => {
    const { activationCode, record } = fixture();
    expect(verifyOfflineClientKey(activationCode, { ...record, status: "REVOKED" }).error).toBe("LICENSE_INACTIVE");
    expect(verifyOfflineClientKey(activationCode, { ...record, isDeleted: true }).error).toBe("LICENSE_INACTIVE");
    expect(verifyOfflineClientKey(activationCode, record, record.expireDate).error).toBe("LICENSE_EXPIRED");
    expect(verifyOfflineClientKey(activationCode, { ...record, expireDate: record.expireDate + 1 }).error).toBe("LICENSE_INVALID");
    expect(verifyOfflineClientKey("different", record).error).toBe("OFFLINE_KEY_NOT_REGISTERED");
  });

  it("rejects a modified RSA signature even when the row has the same code", () => {
    const { activationCode, record } = fixture();
    const envelope = JSON.parse(Buffer.from(activationCode, "base64").toString());
    envelope.signature = Buffer.from("invalid").toString("base64");
    const tampered = Buffer.from(JSON.stringify(envelope)).toString("base64");
    expect(verifyOfflineClientKey(tampered, { ...record, activationCode: tampered }).error).toBe("LICENSE_INVALID");
  });
});

describe("online key access to company system packages", () => {
  it("does not grant desktop delivery from an SDK all license", () => {
    const keyString = generateLicenseKey("all", 1, "production", "shroom-sdk");
    expect(verifyOnlineClientKey(keyString, { keyString, productType: "shroom-sdk", status: "ISSUED", isDeleted: false,
      customerId: null, expireTimestamp: Date.now() + 3600000 }).error).toBe("PRODUCT_MISMATCH");
  });
  /** Prepare a registered online key without requiring a customer account. */
  function online(scope: string[] | "all" = ["seatpad"]) {
    const keyString = generateLicenseKey(scope, 1);
    return { keyString, record: { keyString, status: "ISSUED", isDeleted: false,
      customerId: null, expireTimestamp: Date.now() + 3600000 } };
  }

  it("uses the encrypted scope directly even when no customer is associated", () => {
    const { keyString, record } = online();
    expect(verifyOnlineClientKey(keyString, record)).toMatchObject({ grant: { customerId: null, scope: ["seatpad"] } });
    expect(verifyOnlineClientKey(keyString, record).grant?.expiresAt).toBe(record.expireTimestamp);
    expect(verifyOnlineClientKey(keyString, { ...record, customerId: 42 }).grant)
      .toMatchObject({ customerId: 42, scope: ["seatpad"] });
  });

  it("preserves all and group scope semantics without granting unrelated company systems", () => {
    const unlimited = online("all");
    expect(verifyOnlineClientKey(unlimited.keyString, unlimited.record).grant?.scope).toBe("all");
    const group = getLicenseGroupKeys()[0], grouped = online([`@group:${group}`]);
    expect(verifyOnlineClientKey(grouped.keyString, grouped.record).grant?.scope).toEqual(getGroupSensorTypes(group));
    const invalidKey = aesEncrypt(JSON.stringify({ date: Date.now() + 3600000, file: "@group:unregistered-test-group" }));
    expect(verifyOnlineClientKey(invalidKey, { ...grouped.record, keyString: invalidKey }).error).toBe("LICENSE_INVALID");
  });

  it("accepts hex casing from a historical row without widening its signed grant scope", () => {
    const { keyString, record } = online(["seatpad"]);
    expect(verifyOnlineClientKey(keyString, { ...record, keyString: keyString.toUpperCase() }).grant?.scope).toEqual(["seatpad"]);
    expect(verifyOnlineClientKey(keyString.toUpperCase(), record).grant?.scope).toEqual(["seatpad"]);
    expect(verifyOnlineClientKey(keyString, { ...record, keyString: keyString.toUpperCase(), status: "REVOKED" }).error).toBe("LICENSE_INACTIVE");
  });

  it("rejects deleted, revoked, expired and mismatched records and invalid payloads", () => {
    const { keyString, record } = online();
    expect(verifyOnlineClientKey(keyString, { ...record, isDeleted: true }).error).toBe("LICENSE_INACTIVE");
    expect(verifyOnlineClientKey(keyString, { ...record, status: "REVOKED" }).error).toBe("LICENSE_INACTIVE");
    expect(verifyOnlineClientKey(keyString, record, record.expireTimestamp).error).toBe("LICENSE_EXPIRED");
    expect(verifyOnlineClientKey(keyString, { ...record, expireTimestamp: NaN }).error).toBe("LICENSE_EXPIRED");
    expect(verifyOnlineClientKey("invalid", record).error).toBe("LICENSE_INACTIVE");
    expect(verifyOnlineClientKey("invalid", { ...record, keyString: "invalid" }).error).toBe("LICENSE_INVALID");
  });
});
