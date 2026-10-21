import express, { type Express, type Request, type Response } from "express";
import { createHash, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { customers, licenseKeys, offlineKeys, rsaKeyPairs, systemPackageEvents, systemPackageRollouts, systemPackageSubmissions, systemPackageSubmitTokens, users } from "../drizzle/schema";
import { getRegistrySensorTypes } from "../shared/licenseScopes";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { type ClientLicenseResult, verifyOfflineClientKey, verifyOnlineClientKey } from "./systemPackageClientLicense";
import { uploadRetentionPolicy } from "./uploadRetention";

const MAX_BODY = "18mb";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
type Audience = "all" | number[];
type Rollout = { systemId: string; customerId: number; versionId: number };
type WithdrawalMode = "stop-distribution" | "stop-new-acquisition";

/** Read only declared installed identities, with bounded cardinality and no ambiguous duplicates. */
export function parseInstalledSystems(input: any): { id: string; version: number }[] | null {
  if (!input || typeof input !== "object" || Object.keys(input).some(key => key !== "systems")
    || !Array.isArray(input.systems) || input.systems.length < 1 || input.systems.length > 32) return null;
  const seen = new Set<string>();
  for (const item of input.systems) {
    if (!item || typeof item !== "object" || Object.keys(item).some(key => !["id", "version"].includes(key))
      || typeof item.id !== "string" || !SAFE_ID.test(item.id) || !Number.isSafeInteger(item.version) || item.version <= 0
      || seen.has(`${item.id}:${item.version}`)) return null;
    seen.add(`${item.id}:${item.version}`);
  }
  return input.systems.map((item: any) => ({ id: item.id as string, version: item.version as number }));
}

/** Old revocations stop distribution; malformed explicit policies conservatively stop new acquisition. */
export function readWithdrawalPolicy(event?: { detailsJson: string; createdAt?: Date }) {
  const fallback = { schemaVersion: 1, mode: "stop-distribution" as WithdrawalMode,
    effectiveAt: event?.createdAt?.getTime() ?? 0, reason: "" };
  if (!event) return fallback;
  try {
    const details = JSON.parse(event.detailsJson);
    if (!details.withdrawal) return fallback;
    const policy = details.withdrawal;
    if (policy.schemaVersion !== 1 || !["stop-distribution", "stop-new-acquisition"].includes(policy.mode)) throw new Error("INVALID_WITHDRAWAL_POLICY");
    return { schemaVersion: 1, mode: policy.mode as WithdrawalMode,
      effectiveAt: Number.isSafeInteger(policy.effectiveAt) ? policy.effectiveAt : fallback.effectiveAt,
      reason: typeof policy.reason === "string" ? policy.reason.slice(0, 400) : "" };
  } catch { return { ...fallback, mode: "stop-new-acquisition" as WithdrawalMode, reason: "withdrawal-policy-unreadable" }; }
}

/** Freeze the previous default before approving a candidate; never replace an explicit pointer. */
export function publicationBaseline(revisions: { id: number; status: string }[], rollouts: { customerId: number }[], candidateId: number) {
  if (rollouts.some(row => row.customerId === 0)) return null;
  return revisions.find(row => row.status === "published")?.id
    ?? revisions.find(row => row.status === "revoked")?.id ?? candidateId;
}

/** Return a stable token for comparing the active rollout state before an admin changes it. */
export function rolloutToken(rows: Rollout[]) {
  const state = rows.map((row) => [row.customerId, row.versionId]).sort((a, b) => a[0] - b[0]);
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

/** Sign a canonical JSON payload with the dedicated package key; no fallback key is allowed. */
function signEnvelope(payload: object) {
  const keyPath = process.env.SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH;
  if (!keyPath) throw new Error("SIGNING_KEY_UNCONFIGURED");
  return sign(null, Buffer.from(JSON.stringify(payload)), readFileSync(keyPath, "utf8")).toString("base64");
}

/** Validate the immutable package envelope before it enters the review queue. */
export function validateSystemPackage(input: any) {
  if (!input || input.schemaVersion !== 1 || !["manifest", "native-template"].includes(input.kind) || !SAFE_ID.test(input.systemId || "")
    || !Array.isArray(input.algorithms) || input.algorithms.length > 8
    || !/^[a-f0-9]{64}$/.test(input.sha256 || "")) throw new Error("INVALID_PACKAGE");
  const { sha256, ...payload } = input;
  if (createHash("sha256").update(JSON.stringify(payload)).digest("hex") !== sha256) throw new Error("PACKAGE_INTEGRITY");
  if (getRegistrySensorTypes().includes(input.systemId)) throw new Error("SYSTEM_ID_RESERVED");
  if (input.kind === "native-template") {
    const declaration = input.template;
    if (!declaration || declaration.id !== input.systemId || !SAFE_ID.test(declaration.sourceType || "")
      || typeof declaration.name !== "string" || !declaration.name.trim() || declaration.name.length > 100
      || !declaration.configuration || !Array.isArray(declaration.configuration.algorithms)
      || !Array.isArray(declaration.configuration.charts)) throw new Error("INVALID_PACKAGE");
    return { systemId: input.systemId as string, sha256: input.sha256 as string, name: declaration.name as string };
  }
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 128) throw new Error("INVALID_PACKAGE");
  const seen = new Set<string>();
  for (const file of input.files) {
    if (typeof file.path !== "string" || file.path.length > 240 || file.path.includes("\\") || file.path.includes(":")
      || file.path.split("/").some((part: string) => !part || part === "." || part === ".."
        || /[\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))
      || !file.path.endsWith(".json") || seen.has(file.path) || !Number.isInteger(file.size)
      || file.size < 0 || file.size > 16 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256 || "")) throw new Error("INVALID_PACKAGE_FILE");
    seen.add(file.path);
    const bytes = Buffer.from(file.contentBase64 || "", "base64");
    if (bytes.length !== file.size || bytes.toString("base64") !== file.contentBase64
      || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("PACKAGE_INTEGRITY");
  }
  const manifestFile = input.files.find((file: any) => file.path === "display-system.json");
  if (!manifestFile) throw new Error("INVALID_PACKAGE");
  const manifest = JSON.parse(Buffer.from(manifestFile.contentBase64, "base64").toString("utf8"));
  if (manifest.id !== input.systemId) throw new Error("INVALID_PACKAGE");
  const sensors = manifest.sensors || (manifest.sensor ? [manifest.sensor] : []);
  if (sensors.some((sensor: any) => getRegistrySensorTypes().includes(sensor.type))) throw new Error("SYSTEM_SENSOR_TYPE_RESERVED");
  const name = String(manifest.name || input.systemId).trim().slice(0, 160);
  return { systemId: input.systemId as string, sha256: input.sha256 as string, name };
}

/** Authenticate a registered online or offline software key before granting company packages. */
async function clientLicense(req: Request): Promise<ClientLicenseResult> {
  const key = /^License (\S{32,8192})$/.exec(req.get("authorization") || "")?.[1];
  if (!key) return { error: "LICENSE_INVALID" };
  const db = await getDb();
  if (!db) return { error: "STORAGE_UNAVAILABLE" };
  if (/^[a-fA-F0-9]{32,8192}$/.test(key)) {
    const [row] = await db.select({ productType: licenseKeys.productType, keyString: licenseKeys.keyString, status: licenseKeys.status,
      expireTimestamp: licenseKeys.expireTimestamp, customerId: licenseKeys.customerId, isDeleted: licenseKeys.isDeleted })
      .from(licenseKeys)
      .where(eq(licenseKeys.keyString, key)).limit(1);
    return row ? verifyOnlineClientKey(key, row) : { error: "LICENSE_INACTIVE" };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) return { error: "LICENSE_INVALID" };
  const [row] = await db.select({ productType: offlineKeys.productType, activationCode: offlineKeys.activationCode, status: offlineKeys.status,
    isDeleted: offlineKeys.isDeleted, customerId: offlineKeys.customerId,
    expireDate: offlineKeys.expireDate,
    publicKey: rsaKeyPairs.publicKey })
    .from(offlineKeys).innerJoin(rsaKeyPairs, eq(rsaKeyPairs.id, offlineKeys.rsaKeyPairId))
    .where(eq(offlineKeys.activationCode, key)).limit(1);
  return row ? verifyOfflineClientKey(key, row) : { error: "OFFLINE_KEY_NOT_REGISTERED" };
}

/** Select the latest published release in a key's scope, ignoring historical customer audience metadata. */
export function visibleReleases<T extends { systemId: string; audienceJson: string | null; status: string }>(
  rows: T[], _customerId: number | null, scope: "all" | string[] = "all"
): T[] {
  const found = new Map<string, T>();
  for (const row of rows) {
    if (row.status !== "published" || found.has(row.systemId)
      || (scope !== "all" && !scope.includes(row.systemId))) continue;
    found.set(row.systemId, row);
  }
  return Array.from(found.values());
}

/** Resolve authorized versions while preserving explicit rollback and withdrawal pointers. */
export function activeReleases<T extends { id: number; systemId: string; audienceJson: string | null; status: string }>(
  rows: T[], rollouts: Rollout[], customerId: number | null, scope: "all" | string[] = "all"
): T[] {
  const bySystem = new Map<string, T[]>();
  for (const row of rows) {
    if (scope !== "all" && !scope.includes(row.systemId)) continue;
    const group = bySystem.get(row.systemId) || [];
    group.push(row); bySystem.set(row.systemId, group);
  }
  const selected: T[] = [];
  for (const [systemId, releases] of Array.from(bySystem.entries())) {
    const pointer = rollouts.find((item) => item.systemId === systemId && item.customerId === customerId)
      || rollouts.find((item) => item.systemId === systemId && item.customerId === 0);
    if (pointer) {
      const active = releases.find((row) => row.id === pointer.versionId && row.status === "published");
      if (active) selected.push(active);
    } else {
      const legacy = visibleReleases(releases, customerId)[0];
      if (legacy) selected.push(legacy);
    }
  }
  return selected;
}

/** Match the desktop loader's v1/v2 port expansion and v3 default output channel. */
function effectiveSensors(manifest: any): any[] {
  if (Array.isArray(manifest.sensors)) return manifest.sensors;
  if (!manifest.sensor) return [];
  const legacy = manifest.sensor;
  const ports: string[] = Array.isArray(legacy.ports) && legacy.ports.length ? legacy.ports : [legacy.id || "default"];
  return ports.map((port) => ({ ...legacy, id: port, outputChannel: port }));
}

/** Read a Manifest system's persisted-frame identity from its immutable package. */
function manifestContract(input: any) {
  const file = input.files?.find((item: any) => item.path === "display-system.json");
  if (!file) throw new Error("INVALID_PACKAGE");
  const manifest = JSON.parse(Buffer.from(file.contentBase64, "base64").toString("utf8"));
  const sensors = effectiveSensors(manifest);
  return { manifest, identity: sensors.map((sensor: any) => ({ id: sensor.id ?? null, type: sensor.type ?? null,
    outputChannel: sensor.outputChannel ?? sensor.id ?? null, rows: sensor.matrix?.rows ?? null, cols: sensor.matrix?.cols ?? null }))
    .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))) };
}

/** Resolve declared line-order assets, including custom filenames relative to sensor folders. */
function lineOrderAssets(manifest: any, files: Map<string, string>) {
  const assets = new Map<string, { path: string; sha256: string | null }>();
  const add = (label: string, value: unknown, sensorId?: string) => {
    const raw = typeof value === "string" ? value : (value && typeof value === "object" ? (value as any).path : null);
    if (typeof raw !== "string" || !raw) return;
    const path = raw.replace(/^\.\//, "");
    const paths = Array.from(files.keys());
    const resolved = paths.find((item) => item === path)
      || (sensorId ? paths.find((item) => item === `${sensorId}/${path}`) : undefined)
      || paths.find((item) => item.endsWith(`/${path}`)) || path;
    assets.set(label, { path: resolved, sha256: files.get(resolved) || null });
  };
  add("root.lineOrder", manifest.files?.lineOrder);
  add("root.pointOrder", manifest.files?.pointOrder);
  for (const sensor of effectiveSensors(manifest)) {
    const label = String(sensor.id ?? sensor.type ?? "sensor");
    add(`${label}.lineOrder`, sensor.files?.lineOrder, label);
    add(`${label}.pointOrder`, sensor.files?.pointOrder, label);
  }
  return assets;
}

/** Explain review-relevant changes, and mark changes that would reinterpret stored frames. */
export function systemPackageDiff(previous: any, next: any) {
  if (previous.kind !== "manifest" || next.kind !== "manifest") return { dataContractChanged: false,
    protocolChanged: false, lineOrderChanged: false, changedFiles: [] as string[],
    dataContract: null, protocol: null, lineOrders: [] as { path: string; beforePath: string | null;
      afterPath: string | null; before: string | null; after: string | null }[] };
  const oldValue = manifestContract(previous), newValue = manifestContract(next);
  const oldFiles = new Map<string, string>(previous.files.map((file: any) => [file.path, file.sha256]));
  const newFiles = new Map<string, string>(next.files.map((file: any) => [file.path, file.sha256]));
  const changedFiles = Array.from(new Set<string>([...Array.from(oldFiles.keys()), ...Array.from(newFiles.keys())]))
    .filter((path) => oldFiles.get(path) !== newFiles.get(path));
  const oldLineOrders = lineOrderAssets(oldValue.manifest, oldFiles);
  const newLineOrders = lineOrderAssets(newValue.manifest, newFiles);
  const lineOrders = Array.from(new Set<string>([...Array.from(oldLineOrders.keys()), ...Array.from(newLineOrders.keys())]))
    .filter((label) => JSON.stringify(oldLineOrders.get(label)) !== JSON.stringify(newLineOrders.get(label)))
    .map((label) => ({ path: label, beforePath: oldLineOrders.get(label)?.path || null,
      afterPath: newLineOrders.get(label)?.path || null, before: oldLineOrders.get(label)?.sha256 || null,
      after: newLineOrders.get(label)?.sha256 || null }));
  for (const path of changedFiles.filter((item) => /(?:^|\/)(?:line-order|point-order)\.json$/i.test(item))) {
    if (!lineOrders.some((item) => item.beforePath === path || item.afterPath === path)) {
      lineOrders.push({ path, beforePath: oldFiles.has(path) ? path : null,
        afterPath: newFiles.has(path) ? path : null, before: oldFiles.get(path) || null,
        after: newFiles.get(path) || null });
    }
  }
  const protocols = (manifest: any) => effectiveSensors(manifest)
    .map((sensor: any) => ({ id: sensor.id, protocol: sensor.protocol })).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  const oldProtocol = protocols(oldValue.manifest), newProtocol = protocols(newValue.manifest);
  const protocolBefore = { sensors: oldProtocol, root: oldValue.manifest.protocol || null };
  const protocolAfter = { sensors: newProtocol, root: newValue.manifest.protocol || null };
  return { dataContractChanged: JSON.stringify(oldValue.identity) !== JSON.stringify(newValue.identity),
    protocolChanged: JSON.stringify(oldProtocol) !== JSON.stringify(newProtocol)
      || JSON.stringify(oldValue.manifest.protocol) !== JSON.stringify(newValue.manifest.protocol),
    lineOrderChanged: lineOrders.length > 0,
    changedFiles, dataContract: { before: oldValue.identity, after: newValue.identity },
    protocol: { before: protocolBefore, after: protocolAfter },
    lineOrders };
}

/** Require an explicit current release when a submitted ID is an update. */
export function checkSystemPackageIdentity(input: any, baseVersion: unknown, current?: { id: number; packageJson: string }) {
  if (!current) {
    if (baseVersion !== undefined && baseVersion !== null) return { error: "SYSTEM_UPDATE_TARGET_MISSING" };
    return null;
  }
  if (baseVersion !== current.id) return { error: "SYSTEM_ID_ALREADY_PUBLISHED", currentVersion: current.id };
  const previous = JSON.parse(current.packageJson);
  if (previous.kind !== input.kind || (input.kind === "native-template"
    && previous.template?.sourceType !== input.template?.sourceType)) {
    return { error: "SYSTEM_ID_INCOMPATIBLE", currentVersion: current.id };
  }
  if (systemPackageDiff(previous, input).dataContractChanged) {
    return { error: "SYSTEM_ID_DATA_CONTRACT_CHANGED", currentVersion: current.id };
  }
  return null;
}

/** Require a same-origin logged-in staff member; publication requires super-admin. */
async function staff(req: Request, res: Response, superAdmin = false) {
  const origin = req.get("origin");
  try {
    if (origin && new URL(origin).host !== req.get("host")) { res.status(403).json({ error: "ORIGIN_FORBIDDEN" }); return null; }
  } catch { res.status(403).json({ error: "ORIGIN_FORBIDDEN" }); return null; }
  let user;
  try { user = await sdk.authenticateRequest(req); }
  catch { res.status(503).json({ error: "AUTH_UNAVAILABLE" }); return null; }
  if (!user || (superAdmin && user.role !== "super_admin")) { res.status(403).json({ error: "STAFF_REQUIRED" }); return null; }
  return user;
}

/** A staff browser session or scoped bearer token may submit; bearer tokens cannot review. */
async function submitter(req: Request, res: Response) {
  const token = /^Bearer (sps_[A-Za-z0-9_-]{43})$/.exec(req.get("authorization") || "")?.[1];
  if (!token) return staff(req, res);
  const db = await getDb();
  if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return null; }
  const [row] = await db.select({ id: users.id, active: users.isActive, expiresAt: systemPackageSubmitTokens.expiresAt,
    revokedAt: systemPackageSubmitTokens.revokedAt }).from(systemPackageSubmitTokens)
    .innerJoin(users, eq(users.id, systemPackageSubmitTokens.userId))
    .where(eq(systemPackageSubmitTokens.tokenHash, createHash("sha256").update(token).digest("hex"))).limit(1);
  if (!row || !row.active || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    res.status(403).json({ error: "SUBMISSION_TOKEN_INVALID" }); return null;
  }
  return row;
}

/** Bind signed releases and customer entitlements to the existing key-manager HTTP app. */
export function registerSystemPackages(app: Express) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    if (req.method !== "POST" || req.path !== "/submissions") { next(); return; }
    try {
      const user = await submitter(req, res);
      if (user) { res.locals.systemSubmitter = user; next(); }
    } catch { res.status(503).json({ error: "AUTH_UNAVAILABLE" }); }
  });
  router.use(express.json({ limit: MAX_BODY, inflate: false }));

  router.get("/available", async (req, res) => {
    const user = await staff(req, res); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const rows = await db.select({ systemId: systemPackageSubmissions.systemId, name: systemPackageSubmissions.name })
      .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.status, "published"))
      .orderBy(desc(systemPackageSubmissions.id));
    const seen = new Set<string>();
    res.json({ systems: rows.filter((row) => !seen.has(row.systemId) && Boolean(seen.add(row.systemId))) });
  });

  router.post("/submissions", async (req, res) => {
    try {
      const user = res.locals.systemSubmitter;
      const metadata = validateSystemPackage(req.body?.package);
      const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
      const outcome = await db.transaction(async (tx) => {
        // ⚠️ A competing employee submission must not claim the same ID between lookup and insert.
        const revisions = await tx.select().from(systemPackageSubmissions)
          .where(eq(systemPackageSubmissions.systemId, metadata.systemId))
          .orderBy(desc(systemPackageSubmissions.id)).for("update");
        const existing = revisions.find((item) => item.sha256 === metadata.sha256 && item.submittedById === user.id
          && ["pending", "published"].includes(item.status));
        if (existing) return { status: 200, body: { id: existing.id, status: existing.status, ...metadata } };
        const current = revisions.find((item) => item.status === "published") ?? revisions.find((item) => item.status === "revoked");
        const conflict = checkSystemPackageIdentity(req.body.package, req.body?.baseVersion, current);
        if (conflict) return { status: 409, body: conflict };
        const pending = revisions.find((item) => item.status === "pending");
        if (pending) return { status: 409, body: { error: "SYSTEM_ID_PENDING", pendingId: pending.id } };
        const [{ id }] = await tx.insert(systemPackageSubmissions).values({ ...metadata,
          packageJson: JSON.stringify(req.body.package), baseVersion: current?.id || null, submittedById: user.id }).$returningId();
        await tx.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id, action: "submitted",
          detailsJson: JSON.stringify({ baseVersion: current?.id || null }) });
        return { status: 201, body: { id, status: "pending", ...metadata } };
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      const databaseCode = (error as { code?: string })?.code;
      if (databaseCode === "ER_LOCK_DEADLOCK" || databaseCode === "ER_LOCK_WAIT_TIMEOUT") {
        res.status(409).json({ error: "SYSTEM_ID_BUSY" }); return;
      }
      res.status(error instanceof Error && error.message === "STORAGE_UNAVAILABLE" ? 503 : 400)
        .json({ error: error instanceof Error ? error.message : "INVALID_PACKAGE" });
    }
  });

  router.get("/staff-tokens", async (req, res) => {
    const user = await staff(req, res); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const tokens = await db.select({ id: systemPackageSubmitTokens.id, createdAt: systemPackageSubmitTokens.createdAt,
      expiresAt: systemPackageSubmitTokens.expiresAt, revokedAt: systemPackageSubmitTokens.revokedAt })
      .from(systemPackageSubmitTokens).where(eq(systemPackageSubmitTokens.userId, user.id))
      .orderBy(desc(systemPackageSubmitTokens.id)).limit(20);
    res.json({ tokens });
  });

  router.post("/staff-tokens", async (req, res) => {
    const user = await staff(req, res); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const token = `sps_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const [{ id }] = await db.insert(systemPackageSubmitTokens).values({ userId: user.id, expiresAt,
      tokenHash: createHash("sha256").update(token).digest("hex") }).$returningId();
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ id, token, expiresAt });
  });

  router.delete("/staff-tokens/:id", async (req, res) => {
    const user = await staff(req, res); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    await db.update(systemPackageSubmitTokens).set({ revokedAt: new Date() })
      .where(and(eq(systemPackageSubmitTokens.id, Number(req.params.id)), eq(systemPackageSubmitTokens.userId, user.id)));
    res.json({ revoked: true });
  });

  router.get("/staff/releases", async (req, res) => {
    const user = await submitter(req, res); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const rows = await db.select({ id: systemPackageSubmissions.id, systemId: systemPackageSubmissions.systemId,
      name: systemPackageSubmissions.name, sha256: systemPackageSubmissions.sha256,
      kind: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${systemPackageSubmissions.packageJson}, '$.kind'))` })
      .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.status, "published"))
      .orderBy(desc(systemPackageSubmissions.id));
    const seen = new Set<string>();
    res.setHeader("Cache-Control", "no-store");
    res.json({ releases: rows.filter((row) => !seen.has(row.systemId) && Boolean(seen.add(row.systemId)))
      .map((row) => ({ systemId: row.systemId, name: row.name, version: row.id,
        kind: row.kind, sha256: row.sha256 })) });
  });

  router.get("/staff/releases/:systemId/:version", async (req, res) => {
    const user = await submitter(req, res); if (!user) return;
    const version = Number(req.params.version);
    if (!SAFE_ID.test(req.params.systemId) || !Number.isSafeInteger(version) || version <= 0) {
      res.status(400).json({ error: "INVALID_RELEASE" }); return;
    }
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const [row] = await db.select().from(systemPackageSubmissions)
      .where(and(eq(systemPackageSubmissions.id, version), eq(systemPackageSubmissions.systemId, req.params.systemId),
        eq(systemPackageSubmissions.status, "published"))).limit(1);
    if (!row) { res.status(404).json({ error: "RELEASE_NOT_FOUND" }); return; }
    try {
      const packageValue = JSON.parse(row.packageJson);
      if (validateSystemPackage(packageValue).sha256 !== row.sha256) throw new Error("PACKAGE_INTEGRITY");
      res.setHeader("Cache-Control", "no-store");
      res.json({ systemId: row.systemId, version: row.id, sha256: row.sha256,
        package: packageValue, signature: row.signature });
    } catch { res.status(503).json({ error: "RELEASE_CORRUPT" }); }
  });

  router.get("/admin/submissions", async (req, res) => {
    const user = await staff(req, res, true); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const rows = await db.select({ id: systemPackageSubmissions.id, systemId: systemPackageSubmissions.systemId,
      name: systemPackageSubmissions.name, sha256: systemPackageSubmissions.sha256, status: systemPackageSubmissions.status,
      baseVersion: systemPackageSubmissions.baseVersion,
      submittedById: systemPackageSubmissions.submittedById, reviewNote: systemPackageSubmissions.reviewNote,
      audienceJson: systemPackageSubmissions.audienceJson, createdAt: systemPackageSubmissions.createdAt,
      publishedAt: systemPackageSubmissions.publishedAt }).from(systemPackageSubmissions)
      .orderBy(desc(systemPackageSubmissions.id)).limit(200);
    res.json({ items: rows });
  });

  router.get("/admin/submissions/:id", async (req, res) => {
    const user = await staff(req, res, true); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const [row] = await db.select().from(systemPackageSubmissions).where(eq(systemPackageSubmissions.id, Number(req.params.id))).limit(1);
    if (!row) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    const value = JSON.parse(row.packageJson);
    let [current] = await db.select({ id: systemPackageSubmissions.id, name: systemPackageSubmissions.name,
      packageJson: systemPackageSubmissions.packageJson }).from(systemPackageSubmissions)
      .where(and(eq(systemPackageSubmissions.systemId, row.systemId), eq(systemPackageSubmissions.status, "published")))
      .orderBy(desc(systemPackageSubmissions.id)).limit(1);
    if (!current) [current] = await db.select({ id: systemPackageSubmissions.id, name: systemPackageSubmissions.name,
      packageJson: systemPackageSubmissions.packageJson }).from(systemPackageSubmissions)
      .where(and(eq(systemPackageSubmissions.systemId, row.systemId), eq(systemPackageSubmissions.status, "revoked")))
      .orderBy(desc(systemPackageSubmissions.id)).limit(1);
    const [base] = row.baseVersion ? await db.select({ packageJson: systemPackageSubmissions.packageJson })
      .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.id, row.baseVersion)).limit(1) : [];
    const versions = await db.select({ id: systemPackageSubmissions.id, name: systemPackageSubmissions.name,
      publishedAt: systemPackageSubmissions.publishedAt }).from(systemPackageSubmissions)
      .where(and(eq(systemPackageSubmissions.systemId, row.systemId), eq(systemPackageSubmissions.status, "published")))
      .orderBy(desc(systemPackageSubmissions.id));
    const rollouts = await db.select().from(systemPackageRollouts)
      .where(eq(systemPackageRollouts.systemId, row.systemId));
    const [withdrawalEvent] = row.status === "revoked" ? await db.select().from(systemPackageEvents)
      .where(and(eq(systemPackageEvents.submissionId, row.id), inArray(systemPackageEvents.action, ["revoked", "withdrawal-policy"])))
      .orderBy(desc(systemPackageEvents.id)).limit(1) : [];
    res.json({ id: row.id, systemId: row.systemId, status: row.status, kind: value.kind,
      withdrawal: row.status === "revoked" ? readWithdrawalPolicy(withdrawalEvent) : null,
      baseVersion: row.baseVersion, currentPublished: current ? { id: current.id, name: current.name } : null,
      diff: base ? systemPackageDiff(JSON.parse(base.packageJson), value) : null,
      versions, rollouts: rollouts.map((item) => ({ customerId: item.customerId, versionId: item.versionId })),
      publication: { mode: "candidate-then-promote", firstPublication: !current,
        defaultVersion: rollouts.find((item) => item.customerId === 0)?.versionId ?? current?.id ?? null,
        affectedOnApproval: current ? "none" : "all-authorized-without-customer-override",
        customerOverrides: rollouts.filter((item) => item.customerId !== 0).length },
      rolloutToken: rolloutToken(rollouts),
      files: (value.files || []).map((file: any) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
      algorithms: value.algorithms.map((item: any) => ({ id: item.id, name: item.name, report: item.report })), bindings: value.bindings,
      manifest: value.kind === "manifest" ? JSON.parse(Buffer.from(value.files.find((file: any) => file.path === "display-system.json").contentBase64, "base64").toString("utf8")) : value.template });
  });

  router.post("/admin/submissions/:id/reject", async (req, res) => {
    const user = await staff(req, res, true); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const id = Number(req.params.id), note = String(req.body?.note || "").slice(0, 2000);
    const result = await db.update(systemPackageSubmissions).set({ status: "rejected", reviewedById: user.id, reviewNote: note })
      .where(and(eq(systemPackageSubmissions.id, id), eq(systemPackageSubmissions.status, "pending")));
    if (!result[0].affectedRows) { res.status(409).json({ error: "STATUS_CHANGED" }); return; }
    await db.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id, action: "rejected", detailsJson: JSON.stringify({ note }) });
    res.json({ id, status: "rejected" });
  });

  router.post("/admin/submissions/:id/publish", async (req, res) => {
    try {
      const user = await staff(req, res, true); if (!user) return;
      const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
      const id = Number(req.params.id);
      const [row] = await db.select().from(systemPackageSubmissions).where(eq(systemPackageSubmissions.id, id)).limit(1);
      if (!row || row.status !== "pending") { res.status(409).json({ error: "STATUS_CHANGED" }); return; }
      const keyPath = process.env.SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH;
      if (!keyPath) { res.status(503).json({ error: "SIGNING_KEY_UNCONFIGURED" }); return; }
      const signature = sign(null, Buffer.from(row.sha256, "hex"), readFileSync(keyPath, "utf8")).toString("base64");
      const result = await db.transaction(async (tx) => {
        // ⚠️ Lock every revision of this ID: two reviewers must not publish competing "latest" versions.
        const revisions = await tx.select().from(systemPackageSubmissions)
          .where(eq(systemPackageSubmissions.systemId, row.systemId)).orderBy(desc(systemPackageSubmissions.id)).for("update");
        const pending = revisions.find((item) => item.id === id);
        if (!pending || pending.status !== "pending") return { error: "STATUS_CHANGED" };
        const current = revisions.find((item) => item.status === "published") ?? revisions.find((item) => item.status === "revoked");
        const conflict = checkSystemPackageIdentity(JSON.parse(pending.packageJson), pending.baseVersion, current);
        if (conflict) return conflict;
        if (current && req.body?.confirmBaseVersion !== current.id) {
          return { error: "SYSTEM_UPDATE_CONFIRMATION_REQUIRED", currentVersion: current.id };
        }
        const pointers = await tx.select().from(systemPackageRollouts)
          .where(eq(systemPackageRollouts.systemId, row.systemId)).for("update");
        const baseline = publicationBaseline(revisions, pointers, id);
        await tx.update(systemPackageSubmissions).set({ status: "published", reviewedById: user.id,
          audienceJson: JSON.stringify("candidate"), signature, publishedAt: new Date() })
          .where(and(eq(systemPackageSubmissions.id, id), eq(systemPackageSubmissions.status, "pending")));
        if (baseline !== null) {
          await tx.insert(systemPackageRollouts).values({ systemId: row.systemId, customerId: 0,
            versionId: baseline, updatedById: user.id });
        }
        await tx.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id, action: "published",
          detailsJson: JSON.stringify({ publicationMode: "candidate-then-promote", defaultBaseline: baseline,
            firstPublication: !current, baseVersion: current?.id || null, legacyAudienceIgnored: req.body?.audience !== undefined }) });
        return null;
      });
      if (result) { res.status(409).json(result); return; }
      res.json({ id, version: id, status: "published", publicationMode: "candidate-then-promote" });
    } catch { res.status(503).json({ error: "PUBLISH_FAILED" }); }
  });

  router.post("/admin/releases/:id/activate", async (req, res) => {
    try {
      const user = await staff(req, res, true); if (!user) return;
      const audience = req.body?.audience as Audience;
      if (audience !== "all" && (!Array.isArray(audience) || !audience.length || audience.length > 1000
        || new Set(audience).size !== audience.length || audience.some((id) => !Number.isInteger(id) || id <= 0))) {
        res.status(400).json({ error: "INVALID_AUDIENCE" }); return;
      }
      if (!/^[a-f0-9]{64}$/.test(req.body?.expectedRolloutToken || "")) {
        res.status(400).json({ error: "ROLLOUT_TOKEN_REQUIRED" }); return;
      }
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "INVALID_RELEASE" }); return; }
      const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
      if (audience !== "all") {
        const existing = await db.select({ id: customers.id }).from(customers).where(eq(customers.isActive, true));
        if (audience.some((customerId) => !existing.some((row) => row.id === customerId))) {
          res.status(400).json({ error: "CUSTOMER_UNAVAILABLE" }); return;
        }
      }
      const [target] = await db.select({ systemId: systemPackageSubmissions.systemId })
        .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.id, id)).limit(1);
      if (!target) { res.status(404).json({ error: "RELEASE_NOT_FOUND" }); return; }
      const result = await db.transaction(async (tx) => {
        // ⚠️ Match publish's lock order so approval and rollout cannot race for one system ID.
        const releases = await tx.select({ id: systemPackageSubmissions.id, status: systemPackageSubmissions.status })
          .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.systemId, target.systemId))
          .orderBy(desc(systemPackageSubmissions.id)).for("update");
        if (!releases.some((item) => item.id === id && item.status === "published")) return { error: "RELEASE_NOT_PUBLISHED" };
        const current = await tx.select().from(systemPackageRollouts)
          .where(eq(systemPackageRollouts.systemId, target.systemId)).for("update");
        if (rolloutToken(current) !== req.body.expectedRolloutToken) {
          return { error: "ROLLOUT_CHANGED", rolloutToken: rolloutToken(current) };
        }
        if (audience === "all") {
          await tx.delete(systemPackageRollouts).where(eq(systemPackageRollouts.systemId, target.systemId));
          await tx.insert(systemPackageRollouts).values({ systemId: target.systemId, customerId: 0,
            versionId: id, updatedById: user.id });
        } else {
          await tx.insert(systemPackageRollouts).values(audience.map((customerId) => ({ systemId: target.systemId,
            customerId, versionId: id, updatedById: user.id })))
            .onDuplicateKeyUpdate({ set: { versionId: id, updatedById: user.id, updatedAt: new Date() } });
        }
        await tx.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id, action: "activated",
          detailsJson: JSON.stringify({ audience, previous: current.map((item) => ({ customerId: item.customerId,
            versionId: item.versionId })) }) });
        return null;
      });
      if (result) { res.status(409).json(result); return; }
      res.json({ systemId: target.systemId, version: id, audience, status: "active" });
    } catch (error) {
      const databaseCode = (error as { code?: string })?.code;
      res.status(databaseCode === "ER_LOCK_DEADLOCK" || databaseCode === "ER_LOCK_WAIT_TIMEOUT" ? 409 : 503)
        .json({ error: databaseCode === "ER_LOCK_DEADLOCK" || databaseCode === "ER_LOCK_WAIT_TIMEOUT" ? "ROLLOUT_BUSY" : "ROLLOUT_FAILED" });
    }
  });

  router.post("/admin/submissions/:id/revoke", async (req, res) => {
    try {
      const user = await staff(req, res, true); if (!user) return;
      const mode = req.body?.withdrawalMode ?? "stop-distribution";
      if (!["stop-distribution", "stop-new-acquisition"].includes(mode)
        || (req.body?.reason !== undefined && (typeof req.body.reason !== "string" || req.body.reason.length > 400))) {
        res.status(400).json({ error: "INVALID_WITHDRAWAL_POLICY" }); return;
      }
      const withdrawal = { schemaVersion: 1, mode, effectiveAt: Date.now(), reason: req.body?.reason ?? "" };
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "INVALID_RELEASE" }); return; }
      const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
      const [target] = await db.select({ systemId: systemPackageSubmissions.systemId })
        .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.id, id)).limit(1);
      if (!target) { res.status(404).json({ error: "RELEASE_NOT_FOUND" }); return; }
      const result = await db.transaction(async (tx) => {
        const revisions = await tx.select({ id: systemPackageSubmissions.id, status: systemPackageSubmissions.status })
          .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.systemId, target.systemId))
          .orderBy(desc(systemPackageSubmissions.id)).for("update");
        const targetRevision = revisions.find((item) => item.id === id && ["published", "revoked"].includes(item.status));
        if (!targetRevision) return false;
        if (targetRevision.status === "revoked" && req.body?.withdrawalMode === undefined) return false;
        const pointers = await tx.select({ customerId: systemPackageRollouts.customerId })
          .from(systemPackageRollouts).where(and(eq(systemPackageRollouts.systemId, target.systemId),
            eq(systemPackageRollouts.versionId, id)));
        await tx.update(systemPackageSubmissions).set({ status: "revoked" })
          .where(and(eq(systemPackageSubmissions.id, id), eq(systemPackageSubmissions.status, "published")));
        // ⚠️ Preserve pointers: new downloads stop; installed behavior follows the separately signed version status.
        await tx.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id,
          action: targetRevision.status === "revoked" ? "withdrawal-policy" : "revoked",
          detailsJson: JSON.stringify({ effect: "hide-on-next-sync", withdrawal,
            pointedCustomerIds: pointers.map((item) => item.customerId) }) });
        return true;
      });
      if (!result) { res.status(409).json({ error: "STATUS_CHANGED" }); return; }
      res.json({ id, status: "revoked", withdrawal });
    } catch { res.status(503).json({ error: "REVOKE_FAILED" }); }
  });

  router.get("/client/policy", async (req, res) => {
    try {
      const auth = await clientLicense(req);
      if (!auth.grant) { res.status(auth.error === "STORAGE_UNAVAILABLE" ? 503 : 403).json({ error: auth.error }); return; }
      const policy = { schemaVersion: 1, diagnosticOnly: true, policyVersion: 1,
        issuedAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        keyHash: createHash("sha256").update((req.get("authorization") || "").slice("License ".length)).digest("hex"),
        serverVersion: /^[a-f0-9]{7,64}$/i.test(process.env.KEY_MANAGER_BUILD_SHA || "") ? process.env.KEY_MANAGER_BUILD_SHA : "unknown", publicationMode: "candidate-then-promote",
        withdrawal: { mode: "per-release", defaultMode: "stop-distribution", policyVersion: 1,
          supportedModes: ["stop-distribution", "stop-new-acquisition"] }, catalogTtlHours: 24, deviceLeaseMaxDays: 7,
        retention: uploadRetentionPolicy() };
      res.setHeader("Cache-Control", "no-store");
      res.json({ policy, signature: signEnvelope(policy) });
    } catch { res.status(503).json({ error: "POLICY_UNAVAILABLE" }); }
  });

  router.post("/client/installed-status", async (req, res) => {
    try {
      const auth = await clientLicense(req);
      if (!auth.grant) { res.status(auth.error === "STORAGE_UNAVAILABLE" ? 503 : 403).json({ error: auth.error }); return; }
      const requested = parseInstalledSystems(req.body);
      if (!requested) { res.status(400).json({ error: "INVALID_INSTALLED_SYSTEMS" }); return; }
      const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
      const systems = await db.transaction(async tx => {
        const result = [];
        for (const item of requested) {
          if (auth.grant.scope !== "all" && !auth.grant.scope.includes(item.id)) {
            result.push({ ...item, status: "unauthorized", sha256: null, withdrawal: null }); continue;
          }
          const [release] = await tx.select({ id: systemPackageSubmissions.id, status: systemPackageSubmissions.status,
            sha256: systemPackageSubmissions.sha256 }).from(systemPackageSubmissions)
            .where(and(eq(systemPackageSubmissions.systemId, item.id), eq(systemPackageSubmissions.id, item.version))).limit(1);
          if (!release || !["published", "revoked"].includes(release.status)) {
            result.push({ ...item, status: "unavailable", sha256: null, withdrawal: null }); continue;
          }
          const [event] = release.status === "revoked" ? await tx.select({ detailsJson: systemPackageEvents.detailsJson,
            createdAt: systemPackageEvents.createdAt }).from(systemPackageEvents)
            .where(and(eq(systemPackageEvents.submissionId, item.version), inArray(systemPackageEvents.action, ["revoked", "withdrawal-policy"])))
            .orderBy(desc(systemPackageEvents.id)).limit(1) : [];
          result.push({ ...item, status: release.status, sha256: release.sha256,
            withdrawal: release.status === "revoked" ? readWithdrawalPolicy(event) : null });
        }
        return result;
      });
      const issuedAt = Date.now();
      const grant = { schemaVersion: 1, type: "installed-system-status", issuedAt,
        expiresAt: Math.min(issuedAt + 24 * 60 * 60 * 1000, auth.grant.expiresAt),
        keyHash: createHash("sha256").update((req.get("authorization") || "").slice("License ".length)).digest("hex"), systems };
      res.setHeader("Cache-Control", "no-store"); res.json({ grant, signature: signEnvelope(grant) });
    } catch { res.status(503).json({ error: "INSTALLED_STATUS_UNAVAILABLE" }); }
  });

  router.get("/client/catalog", async (req, res) => {
    try {
      const auth = await clientLicense(req);
      if (!auth.grant) { res.status(auth.error === "STORAGE_UNAVAILABLE" ? 503 : 403).json({ error: auth.error }); return; }
      const client = auth.grant;
      const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
      const systems = await db.transaction(async (tx) => {
        const rows = await tx.select({ id: systemPackageSubmissions.id, systemId: systemPackageSubmissions.systemId,
          name: systemPackageSubmissions.name, sha256: systemPackageSubmissions.sha256,
          status: systemPackageSubmissions.status, audienceJson: systemPackageSubmissions.audienceJson,
          signature: systemPackageSubmissions.signature }).from(systemPackageSubmissions)
          .where(eq(systemPackageSubmissions.status, "published")).orderBy(desc(systemPackageSubmissions.id));
        const rollouts = await tx.select({ systemId: systemPackageRollouts.systemId,
          customerId: systemPackageRollouts.customerId, versionId: systemPackageRollouts.versionId })
          .from(systemPackageRollouts);
        return activeReleases(rows, rollouts, client.customerId, client.scope).map((row) => ({ systemId: row.systemId,
          name: row.name, version: row.id, sha256: row.sha256, signature: row.signature }));
      });
      const key = (req.get("authorization") || "").slice("License ".length);
      const catalog = { issuedAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        keyHash: createHash("sha256").update(key).digest("hex"),
        systems };
      res.setHeader("Cache-Control", "no-store");
      res.json({ catalog, signature: signEnvelope(catalog) });
    } catch { res.status(503).json({ error: "CATALOG_UNAVAILABLE" }); }
  });

  router.get("/client/packages/:id/:version", async (req, res) => {
    try {
      const auth = await clientLicense(req);
      if (!auth.grant) { res.status(auth.error === "STORAGE_UNAVAILABLE" ? 503 : 403).json({ error: auth.error }); return; }
      const client = auth.grant;
      const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
      const row = await db.transaction(async (tx) => {
        const releases = await tx.select({ id: systemPackageSubmissions.id,
          systemId: systemPackageSubmissions.systemId, status: systemPackageSubmissions.status,
          audienceJson: systemPackageSubmissions.audienceJson }).from(systemPackageSubmissions)
          .where(and(eq(systemPackageSubmissions.systemId, req.params.id),
            eq(systemPackageSubmissions.status, "published"))).orderBy(desc(systemPackageSubmissions.id));
        const rollouts = await tx.select({ systemId: systemPackageRollouts.systemId,
          customerId: systemPackageRollouts.customerId, versionId: systemPackageRollouts.versionId })
          .from(systemPackageRollouts).where(eq(systemPackageRollouts.systemId, req.params.id));
        const active = activeReleases(releases, rollouts, client.customerId, client.scope)[0];
        if (!active || active.id !== Number(req.params.version)) return null;
        const [packageRow] = await tx.select().from(systemPackageSubmissions)
          .where(eq(systemPackageSubmissions.id, active.id)).limit(1);
        return packageRow || null;
      });
      if (!row) { res.status(404).json({ error: "NOT_AVAILABLE" }); return; }
      res.setHeader("Cache-Control", "no-store");
      res.json({ package: JSON.parse(row.packageJson), version: row.id, signature: row.signature });
    } catch { res.status(503).json({ error: "PACKAGE_UNAVAILABLE" }); }
  });

  router.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    res.status(error?.type === "entity.too.large" ? 413 : 400).json({ error: error?.type === "entity.too.large" ? "PACKAGE_TOO_LARGE" : "INVALID_JSON" });
  });

  app.use("/api/system-packages", router);
}
