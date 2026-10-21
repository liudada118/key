import { createVerify } from "node:crypto";
import { decodeLicenseKey } from "../shared/crypto";
import { expandLicenseFile } from "../shared/licenseScopes";
import { normalizeLicenseProduct } from "../shared/licenseProducts";

export type ClientLicenseGrant = { customerId: number | null; scope: "all" | string[]; expiresAt: number };
export type ClientLicenseResult = { grant: ClientLicenseGrant; error?: never } | { grant?: never; error: string };

export type OnlineClientKeyRecord = {
  productType?: string;
  keyString: string;
  status: string;
  isDeleted: boolean;
  customerId: number | null;
  expireTimestamp: number;
};

export type OfflineClientKeyRecord = {
  productType?: string;
  activationCode: string;
  status: string;
  isDeleted: boolean;
  customerId: number | null;
  expireDate: number;
  publicKey: string;
};

/** Grant company systems from the online key's scope; customer association is optional metadata. */
export function verifyOnlineClientKey(
  key: string, record: OnlineClientKeyRecord, now = Date.now()
): ClientLicenseResult {
  if (record.keyString.trim().toLowerCase() !== key.trim().toLowerCase() || record.isDeleted || !["ISSUED", "ACTIVATED", "RENEWED"].includes(record.status)) {
    return { error: "LICENSE_INACTIVE" };
  }
  if (!Number.isFinite(record.expireTimestamp) || record.expireTimestamp <= now) return { error: "LICENSE_EXPIRED" };
  const decoded = decodeLicenseKey(key, now);
  if (!decoded.valid) return { error: "LICENSE_INVALID" };
  if (normalizeLicenseProduct(record.productType) !== "shroom-desktop" || decoded.productType !== "shroom-desktop") return { error: "PRODUCT_MISMATCH" };
  return { grant: { customerId: record.customerId, scope: decoded.isAllTypes ? "all" : decoded.sensorTypes || [], expiresAt: record.expireTimestamp } };
}

/** Verify a registered offline code's signature and scope without requiring customer association. */
export function verifyOfflineClientKey(
  key: string, record: OfflineClientKeyRecord, now = Date.now()
): ClientLicenseResult {
  if (record.activationCode !== key) return { error: "OFFLINE_KEY_NOT_REGISTERED" };
  if (record.isDeleted || !["ISSUED", "ACTIVATED", "RENEWED"].includes(record.status)) {
    return { error: "LICENSE_INACTIVE" };
  }
  if (!Number.isFinite(record.expireDate) || record.expireDate <= now) return { error: "LICENSE_EXPIRED" };
  try {
    const envelope = JSON.parse(Buffer.from(key, "base64").toString("utf8"));
    if (typeof envelope?.payload !== "string" || typeof envelope?.signature !== "string"
      || !envelope.payload || !envelope.signature) return { error: "LICENSE_INVALID" };
    const verifier = createVerify("RSA-SHA256");
    verifier.update(envelope.payload);
    verifier.end();
    if (!verifier.verify(record.publicKey, envelope.signature, "base64")) return { error: "LICENSE_INVALID" };
    const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
    if (normalizeLicenseProduct(record.productType) !== "shroom-desktop" || normalizeLicenseProduct(payload.productType) !== "shroom-desktop") return { error: "PRODUCT_MISMATCH" };
    if (payload.expireDate !== record.expireDate) return { error: "LICENSE_INVALID" };
    const expanded = expandLicenseFile(payload.version === 4 && payload.deviceLimit > 0 ? payload.boundSensorTypes : payload.sensorTypes);
    return { grant: { customerId: record.customerId,
      scope: expanded.isAllTypes ? "all" : expanded.sensorTypes, expiresAt: record.expireDate } };
  } catch { return { error: "LICENSE_INVALID" }; }
}
