import { createVerify } from "node:crypto";
import { expandLicenseFile } from "../shared/licenseScopes";

export type ClientLicenseGrant = { customerId: number; scope: "all" | string[] };
export type ClientLicenseResult = { grant: ClientLicenseGrant; error?: never } | { grant?: never; error: string };

export type OfflineClientKeyRecord = {
  activationCode: string;
  status: string;
  isDeleted: boolean;
  customerId: number | null;
  customerActive: boolean | null;
  expireDate: number;
  publicKey: string;
};

/** Verify a registered offline code against its issuing RSA key and current customer entitlement. */
export function verifyOfflineClientKey(
  key: string, record: OfflineClientKeyRecord, now = Date.now()
): ClientLicenseResult {
  if (record.activationCode !== key) return { error: "OFFLINE_KEY_NOT_REGISTERED" };
  if (record.isDeleted || !["ISSUED", "ACTIVATED", "RENEWED"].includes(record.status)) {
    return { error: "LICENSE_INACTIVE" };
  }
  if (!Number.isFinite(record.expireDate) || record.expireDate <= now) return { error: "LICENSE_EXPIRED" };
  if (!record.customerId) return { error: "LICENSE_CUSTOMER_REQUIRED" };
  if (!record.customerActive) return { error: "LICENSE_CUSTOMER_INACTIVE" };
  try {
    const envelope = JSON.parse(Buffer.from(key, "base64").toString("utf8"));
    if (typeof envelope?.payload !== "string" || typeof envelope?.signature !== "string"
      || !envelope.payload || !envelope.signature) return { error: "LICENSE_INVALID" };
    const verifier = createVerify("RSA-SHA256");
    verifier.update(envelope.payload);
    verifier.end();
    if (!verifier.verify(record.publicKey, envelope.signature, "base64")) return { error: "LICENSE_INVALID" };
    const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
    if (payload.expireDate !== record.expireDate) return { error: "LICENSE_INVALID" };
    const expanded = expandLicenseFile(payload.version === 4 && payload.deviceLimit > 0 ? payload.boundSensorTypes : payload.sensorTypes);
    return { grant: { customerId: record.customerId,
      scope: expanded.isAllTypes ? "all" : expanded.sensorTypes } };
  } catch { return { error: "LICENSE_INVALID" }; }
}
