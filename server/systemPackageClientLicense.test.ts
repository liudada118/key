import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyOfflineClientKey } from "./systemPackageClientLicense";

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
  it("grants only the signed scope to the linked active customer", () => {
    const { activationCode, record } = fixture(["seatpad"]);
    expect(verifyOfflineClientKey(activationCode, record)).toEqual({ grant: { customerId: 42, scope: ["seatpad"] } });
  });

  it("allows all systems only for an all-scope key", () => {
    const { activationCode, record } = fixture("all");
    expect(verifyOfflineClientKey(activationCode, record).grant?.scope).toBe("all");
  });

  it("accepts the RSA-signed scope of a device-limited version 4 key", () => {
    const { activationCode, record } = fixture(["seatpad"], 2);
    expect(verifyOfflineClientKey(activationCode, record)).toEqual({ grant: { customerId: 42, scope: ["seatpad"] } });
  });

  it("rejects missing customer, inactive status, expiry, and mismatched records", () => {
    const { activationCode, record } = fixture();
    expect(verifyOfflineClientKey(activationCode, { ...record, customerId: null }).error).toBe("LICENSE_CUSTOMER_REQUIRED");
    expect(verifyOfflineClientKey(activationCode, { ...record, customerActive: false }).error).toBe("LICENSE_CUSTOMER_INACTIVE");
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
