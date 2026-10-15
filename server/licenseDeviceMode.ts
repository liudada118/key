import { sql, type SQL } from "drizzle-orm";
import { licenseDevicePolicies, offlineKeys } from "../drizzle/schema";

export type LicenseDeviceMode = "all" | "unlimited" | "limited";
export type LicenseDeviceKeyType = "online" | "offline";

/** Read only a valid positive limit from stored RSA payloads; damaged historical codes remain listable. */
export function offlineSignedDeviceLimit(): SQL<number> {
  const envelopeText = sql`CONVERT(FROM_BASE64(${offlineKeys.activationCode}) USING utf8mb4)`;
  const envelope = sql`IF(JSON_VALID(${envelopeText}), ${envelopeText}, '{}')`;
  const payloadText = sql`CONVERT(FROM_BASE64(JSON_UNQUOTE(JSON_EXTRACT(${envelope}, '$.payload'))) USING utf8mb4)`;
  const payload = sql`IF(JSON_VALID(${payloadText}), ${payloadText}, '{}')`;
  const value = sql`JSON_UNQUOTE(JSON_EXTRACT(${payload}, '$.deviceLimit'))`;
  return sql<number>`CASE WHEN ${offlineKeys.licenseVersion} = 4 AND ${value} REGEXP '^[0-9]{1,5}$' AND CAST(${value} AS UNSIGNED) BETWEEN 1 AND 10000 THEN CAST(${value} AS UNSIGNED) ELSE 0 END`;
}

/** Resolve the current server policy, falling back to a limited offline code's signed initial limit. */
export function effectiveDeviceLimit(keyType: LicenseDeviceKeyType): SQL<number> {
  return sql<number>`COALESCE(${licenseDevicePolicies.maxDevices}, ${keyType === "offline" ? offlineSignedDeviceLimit() : sql`0`})`.mapWith(Number);
}

/** Keep signed v4 offline codes in the newer-client category even if their server limit becomes unlimited. */
export function restrictedDeviceFormat(keyType: LicenseDeviceKeyType): SQL<boolean> {
  const signed = keyType === "offline" ? offlineSignedDeviceLimit() : sql`0`;
  return sql<boolean>`(${effectiveDeviceLimit(keyType)} > 0 OR ${signed} > 0)`.mapWith(Boolean);
}

/** Apply category filtering in SQL before pagination and counts; omission preserves existing callers. */
export function deviceModeCondition(keyType: LicenseDeviceKeyType, mode?: LicenseDeviceMode): SQL | undefined {
  if (!mode || mode === "all") return undefined;
  return sql`${restrictedDeviceFormat(keyType)} = ${mode === "limited" ? 1 : 0}`;
}
