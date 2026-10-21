import { createHash, createVerify, sign } from "node:crypto";
import express, { type Express } from "express";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { licenseDevicePolicies, licenseDevices, licenseKeys, offlineKeys, rsaKeyPairs } from "../drizzle/schema";
import { getDb } from "./db";
import { normalizeLicenseProduct, licenseSdkFeatures } from "../shared/licenseProducts";
import { expandLicenseFile } from "../shared/licenseScopes";

export const DEVICE_LEASE_MS = 7 * 86400000;
export const DEVICE_ID_PATTERN = /^[a-f0-9]{64}$/;
export type DeviceKeyType = "online" | "offline";
export type DeviceLease = { lease: { schemaVersion: number; keyHash: string; deviceId: string; issuedAt: number; expiresAt: number; deviceLimit: number }; signature: string };
export type DeviceAuthorization = { allowed: boolean; code: string; deviceLimit: number; deviceLease?: DeviceLease };

/** Select a device without exposing hardware identifiers, IP addresses or the software key. */
export function decideDeviceAccess(limit: number, deviceId: unknown, registrations: { deviceId: string; status: string }[]) {
  if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) return { allowed: !limit, code: limit ? "DEVICE_ID_REQUIRED" : "UNLIMITED" };
  const current = registrations.find(item => item.deviceId === deviceId);
  if (current?.status === "revoked") return { allowed: false, code: "DEVICE_REVOKED" };
  if (current?.status === "active") return { allowed: true, code: "REGISTERED" };
  return !limit || registrations.filter(item => item.status === "active").length < limit
    ? { allowed: true, code: "REGISTER" } : { allowed: false, code: "DEVICE_LIMIT_REACHED" };
}

/** Read policy; no policy means unlimited and database errors must not relax an existing limit. */
export async function readDevicePolicy(keyType: DeviceKeyType, keyId: number) {
  const db = await getDb();
  if (!db) throw new Error("DEVICE_STORAGE_UNAVAILABLE");
  const [row] = await db.select().from(licenseDevicePolicies).where(and(eq(licenseDevicePolicies.keyType, keyType), eq(licenseDevicePolicies.keyId, keyId))).limit(1);
  return row?.maxDevices ?? 0;
}

/** Lock the policy row before counting slots so concurrent activations cannot exceed the limit. */
export async function authorizeLicenseDevice(key: { id: number; keyString: string; expireTimestamp: number; keyType?: DeviceKeyType; defaultLimit?: number }, deviceId: unknown, now = Date.now()): Promise<DeviceAuthorization> {
  const db = await getDb();
  if (!db) throw new Error("DEVICE_STORAGE_UNAVAILABLE");
  const keyType = key.keyType || "online";
  return db.transaction(async tx => {
    await tx.insert(licenseDevicePolicies).values({ keyType, keyId: key.id, maxDevices: key.defaultLimit || 0 })
      .onDuplicateKeyUpdate({ set: { keyId: sql`key_id` } });
    const [policy] = await tx.select().from(licenseDevicePolicies).where(and(eq(licenseDevicePolicies.keyType, keyType), eq(licenseDevicePolicies.keyId, key.id))).for("update");
    const identity = and(eq(licenseDevices.keyType, keyType), eq(licenseDevices.keyId, key.id));
    const registrations = await tx.select().from(licenseDevices).where(identity);
    const decision = decideDeviceAccess(policy.maxDevices, deviceId, registrations);
    if (!decision.allowed) return { ...decision, deviceLimit: policy.maxDevices };
    // Older unlimited clients send no computer ID. New clients always receive a signed, bounded allowance.
    if (decision.code === "UNLIMITED" && !key.defaultLimit) return { allowed: true, code: "UNLIMITED", deviceLimit: 0 };
    if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) return { allowed: false, code: "DEVICE_ID_REQUIRED", deviceLimit: policy.maxDevices };
    const keyPath = process.env.SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH;
    if (!keyPath) throw new Error("SIGNING_KEY_UNCONFIGURED");
    const lease = { schemaVersion: 1, keyHash: createHash("sha256").update(key.keyString).digest("hex"), deviceId: deviceId as string,
      issuedAt: now, expiresAt: Math.min(key.expireTimestamp, now + DEVICE_LEASE_MS), deviceLimit: policy.maxDevices };
    const signature = sign(null, Buffer.from(JSON.stringify(lease)), readFileSync(keyPath, "utf8")).toString("base64");
    if (decision.code === "REGISTER") await tx.insert(licenseDevices).values({ keyType, keyId: key.id,
      deviceId: deviceId as string, status: "active", firstSeenAt: now, lastSeenAt: now });
    else await tx.update(licenseDevices).set({ lastSeenAt: now }).where(and(identity, eq(licenseDevices.deviceId, deviceId as string)));
    return { allowed: true, code: decision.code, deviceLimit: policy.maxDevices, deviceLease: { lease, signature } };
  });
}

/** List device registrations for a key already checked by the management permission boundary. */
export async function listLicenseDevices(keyId: number, keyType: DeviceKeyType = "online") {
  const db = await getDb();
  if (!db) throw new Error("DEVICE_STORAGE_UNAVAILABLE");
  let initialLimit = 0;
  if (keyType === "offline") {
    const [key] = await db.select({ code: offlineKeys.activationCode }).from(offlineKeys).where(eq(offlineKeys.id, keyId)).limit(1);
    if (key) initialLimit = offlineLimit(key.code);
  }
  const [policy] = await db.select().from(licenseDevicePolicies).where(and(eq(licenseDevicePolicies.keyType, keyType), eq(licenseDevicePolicies.keyId, keyId))).limit(1);
  return { maxDevices: policy?.maxDevices ?? initialLimit, devices: await db.select().from(licenseDevices)
    .where(and(eq(licenseDevices.keyType, keyType), eq(licenseDevices.keyId, keyId))) };
}

/** The RSA-signed flag decides whether an offline key requires device activation. */
function offlineLimit(code: string) {
  const envelope = JSON.parse(Buffer.from(code, "base64").toString("utf8"));
  const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  return Number.isInteger(payload.deviceLimit) && payload.deviceLimit > 0 ? payload.deviceLimit : 0;
}

/** Update the limit while holding the same policy lock used by activation. */
export async function setLicenseDeviceLimit(keyId: number, maxDevices: number, keyType: DeviceKeyType = "online") {
  if (!Number.isInteger(maxDevices) || maxDevices < 0 || maxDevices > 10000) throw new Error("DEVICE_LIMIT_INVALID");
  const db = await getDb();
  if (!db) throw new Error("DEVICE_STORAGE_UNAVAILABLE");
  const table = keyType === "online" ? licenseKeys : offlineKeys;
  const [key] = await db.select().from(table).where(and(eq(table.id, keyId), eq(table.isDeleted, false))).limit(1);
  if (!key) throw new Error("LICENSE_NOT_FOUND");
  if (keyType === "offline" && maxDevices > 0 && !offlineLimit((key as typeof offlineKeys.$inferSelect).activationCode)) throw new Error("此离线码未签入设备限制，请在离线密钥页面重新签发限定数量的激活码。");
  await db.transaction(async tx => {
    await tx.insert(licenseDevicePolicies).values({ keyType, keyId, maxDevices: 0 }).onDuplicateKeyUpdate({ set: { keyId: sql`key_id` } });
    const scope = and(eq(licenseDevicePolicies.keyType, keyType), eq(licenseDevicePolicies.keyId, keyId));
    await tx.select().from(licenseDevicePolicies).where(scope).for("update");
    const active = await tx.select().from(licenseDevices).where(and(eq(licenseDevices.keyType, keyType), eq(licenseDevices.keyId, keyId), eq(licenseDevices.status, "active")));
    if (maxDevices && active.length > maxDevices) throw new Error("请先解绑多出的电脑，再降低设备上限。");
    await tx.update(licenseDevicePolicies).set({ maxDevices }).where(scope);
  });
  return listLicenseDevices(keyId, keyType);
}

/** Revoke or restore an existing registration; restoration still observes the configured limit. */
export async function changeLicenseDevice(keyId: number, deviceId: string, status: "active" | "revoked", keyType: DeviceKeyType = "online") {
  const db = await getDb();
  if (!db) throw new Error("DEVICE_STORAGE_UNAVAILABLE");
  await db.transaction(async tx => {
    const scope = and(eq(licenseDevicePolicies.keyType, keyType), eq(licenseDevicePolicies.keyId, keyId));
    const [policy] = await tx.select().from(licenseDevicePolicies).where(scope).for("update");
    const identity = and(eq(licenseDevices.keyType, keyType), eq(licenseDevices.keyId, keyId));
    const registrations = await tx.select().from(licenseDevices).where(identity);
    const row = registrations.find(item => item.deviceId === deviceId);
    if (!row) throw new Error("DEVICE_NOT_FOUND");
    if (status === "active" && row.status !== "active" && policy?.maxDevices && registrations.filter(item => item.status === "active").length >= policy.maxDevices) throw new Error("设备数量已达上限，请先解绑其他电脑。");
    await tx.update(licenseDevices).set({ status }).where(and(identity, eq(licenseDevices.deviceId, deviceId)));
  });
  return listLicenseDevices(keyId, keyType);
}

/** Check a limited RSA key online once, then issue a signed allowance for local offline use. */
export function registerOfflineDeviceChecks(app: Express) {
  app.options("/api/license/devices/check", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.sendStatus(204);
  });
  app.post("/api/license/devices/check", express.json({ limit: "16kb" }), async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    try {
      const code = typeof req.body?.key === "string" ? req.body.key.trim() : "", now = Date.now();
      if (!code || code.length > 8192) { res.status(400).json({ error: "LICENSE_INVALID" }); return; }
      const db = await getDb(); if (!db) throw new Error("storage");
      const [row] = await db.select({ key: offlineKeys, publicKey: rsaKeyPairs.publicKey }).from(offlineKeys)
        .innerJoin(rsaKeyPairs, eq(rsaKeyPairs.id, offlineKeys.rsaKeyPairId)).where(eq(offlineKeys.activationCode, code)).limit(1);
      if (!row || row.key.isDeleted || !["ISSUED", "ACTIVATED", "RENEWED"].includes(row.key.status) || row.key.expireDate <= now) {
        res.json({ time: now, valid: false, status: "LICENSE_INACTIVE", reason: "离线密钥已过期、停用或未在服务器登记。" }); return;
      }
      const envelope = JSON.parse(Buffer.from(code, "base64").toString("utf8"));
      const verifier = createVerify("RSA-SHA256"); verifier.update(envelope.payload); verifier.end();
      if (!verifier.verify(row.publicKey, envelope.signature, "base64")) throw new Error("invalid");
      const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
      const productType = normalizeLicenseProduct(payload.productType);
      const requestedProduct = normalizeLicenseProduct(req.body?.productType);
      if (productType !== requestedProduct || normalizeLicenseProduct(row.key.productType) !== requestedProduct) {
        res.json({ time: now, valid: false, status: "PRODUCT_MISMATCH", productType,
          expireTimestamp: now - 1, reason: "密钥所属产品与当前客户端不一致。" }); return;
      }
      const expanded = productType === "shroom-sdk"
        ? { sensorTypes: ["all"], isAllTypes: true }
        : expandLicenseFile(payload.boundSensorTypes ?? payload.sensorTypes);
      const device = await authorizeLicenseDevice({ id: row.key.id, keyString: code, expireTimestamp: row.key.expireDate,
        keyType: "offline", defaultLimit: offlineLimit(code) }, req.body?.deviceId, now);
      res.json({ time: now, valid: device.allowed, status: device.code, expireTimestamp: row.key.expireDate,
        productType, sensorTypes: expanded.sensorTypes, isAllTypes: expanded.isAllTypes,
        sdkFeatures: licenseSdkFeatures(productType),
        leaseExpiresAt: device.allowed ? Math.min(row.key.expireDate, now + 60000) : now,
        reason: device.allowed ? undefined : "此离线密钥的电脑授权不可用，请管理员检查设备数量或解绑状态。",
        deviceLimit: device.deviceLimit, deviceLease: device.deviceLease });
    } catch { res.status(503).json({ error: "LICENSE_SERVICE_UNAVAILABLE" }); }
  });
}
