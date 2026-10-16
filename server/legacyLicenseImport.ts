import { createHash } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { auditLogs, licenseKeys, users } from "../drizzle/schema";
import { decodeLicenseKey } from "../shared/crypto";
import { getDb } from "./db";

type ImportOptions = { keyString: string; operatorId: number; reason: string; apply?: boolean };

/** Register one operator-reviewed legacy key without changing its encrypted scope or expiration. */
export async function registerLegacyOnlineLicense(options: ImportOptions, now = Date.now()) {
  const keyString = options.keyString.trim(), reason = options.reason.trim();
  if (!Number.isSafeInteger(options.operatorId) || options.operatorId < 1) throw new Error("OPERATOR_REQUIRED");
  if (reason.length < 5 || reason.length > 500) throw new Error("REVIEW_REASON_REQUIRED");
  if (keyString.length > 8192 || !/^[a-fA-F0-9]+$/.test(keyString)) throw new Error("LICENSE_INVALID");
  const decoded = decodeLicenseKey(keyString, now);
  if (!decoded.valid || !decoded.sensorType || decoded.sensorType.length > 512
    || !Number.isSafeInteger(decoded.expireTimestamp) || decoded.expireTimestamp! <= now
    || !["production", "rental"].includes(decoded.category || "")) throw new Error("LICENSE_INVALID_OR_EXPIRED");
  const keyHash = createHash("sha256").update(keyString).digest("hex");
  const db = await getDb();
  if (!db) throw new Error("LICENSE_STORAGE_UNAVAILABLE");
  /** Recheck the administrator and existing records inside the same atomic registration boundary. */
  const run = () => db.transaction(async tx => {
    const [operator] = await tx.select().from(users).where(and(eq(users.id, options.operatorId),
      eq(users.role, "super_admin"), eq(users.isActive, true))).limit(1).for("update");
    if (!operator) throw new Error("ACTIVE_SUPER_ADMIN_REQUIRED");
    // Deleted and revoked rows remain authoritative; never replace or reactivate them.
    const [existing] = await tx.select().from(licenseKeys).where(or(eq(licenseKeys.keyHash, keyHash), eq(licenseKeys.keyString, keyString))).limit(1).for("update");
    const summary = { keyHash, sensorType: decoded.sensorType!, expireTimestamp: decoded.expireTimestamp!,
      category: decoded.category as "production" | "rental" };
    if (existing) {
      if (existing.isDeleted || !["ISSUED", "ACTIVATED", "RENEWED"].includes(existing.status)
        || existing.expireTimestamp <= now) throw new Error("EXISTING_LICENSE_INACTIVE");
      return { ...summary, outcome: "EXISTS" as const, keyId: existing.id, applied: false };
    }
    if (!options.apply) return { ...summary, outcome: "DRY_RUN" as const, keyId: null, applied: false };
    const [insert] = await tx.insert(licenseKeys).values({
      keyString, keyHash, sensorType: summary.sensorType, category: summary.category,
      days: Math.ceil((summary.expireTimestamp - now) / 86400000), expireTimestamp: summary.expireTimestamp,
      createdById: operator.id, createdByName: operator.name || operator.username, status: "ISSUED",
      remark: `人工审核补录旧密钥：${reason}`,
    });
    await tx.insert(auditLogs).values({ userId: operator.id, userName: operator.name || operator.username,
      action: "CREATE", resourceType: "licenseKey", resourceId: insert.insertId,
      description: `人工审核补录原密钥（${keyHash.slice(-12)}）：${reason}`,
      after: JSON.stringify(summary) });
    return { ...summary, outcome: "REGISTERED" as const, keyId: insert.insertId, applied: true };
  });
  try { return await run(); }
  catch (error) {
    // A concurrent reviewed import can win the unique hash; reread without overwriting its row.
    const candidate = error as { code?: string; cause?: { code?: string } };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.cause?.code === "ER_DUP_ENTRY") return run();
    throw error;
  }
}
