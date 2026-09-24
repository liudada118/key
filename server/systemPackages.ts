import express, { type Express, type Request, type Response } from "express";
import { createHash, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import { customers, licenseKeys, systemPackageEvents, systemPackageSubmissions, systemPackageSubmitTokens, users } from "../drizzle/schema";
import { decodeLicenseKey } from "../shared/crypto";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";

const MAX_BODY = "18mb";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
type Audience = "all" | number[];

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
  const name = String(manifest.name || input.systemId).trim().slice(0, 160);
  return { systemId: input.systemId as string, sha256: input.sha256 as string, name };
}

/** Authenticate the actual customer-linked software key for catalog and package download. */
async function clientCustomer(req: Request) {
  const key = /^License ([a-fA-F0-9]{32,8192})$/.exec(req.get("authorization") || "")?.[1];
  if (!key || !decodeLicenseKey(key, Date.now()).valid) return null;
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select({ status: licenseKeys.status, expiresAt: licenseKeys.expireTimestamp,
    customerId: licenseKeys.customerId, active: customers.isActive, deleted: licenseKeys.isDeleted })
    .from(licenseKeys).leftJoin(customers, eq(customers.id, licenseKeys.customerId))
    .where(eq(licenseKeys.keyString, key)).limit(1);
  return row && !row.deleted && row.active && row.customerId && row.expiresAt > Date.now()
    && ["ISSUED", "ACTIVATED", "RENEWED"].includes(row.status) ? row.customerId : null;
}

/** Select the latest release visible to this customer, falling back after a revocation. */
export function visibleReleases<T extends { systemId: string; audienceJson: string | null; status: string }>(rows: T[], customerId: number): T[] {
  const found = new Map<string, T>();
  for (const row of rows) {
    if (row.status !== "published" || found.has(row.systemId)) continue;
    const audience: Audience = JSON.parse(row.audienceJson || "[]");
    if (audience === "all" || (Array.isArray(audience) && audience.includes(customerId))) found.set(row.systemId, row);
  }
  return Array.from(found.values());
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

  router.post("/submissions", async (req, res) => {
    try {
      const user = res.locals.systemSubmitter;
      const metadata = validateSystemPackage(req.body?.package);
      const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
      const [existing] = await db.select({ id: systemPackageSubmissions.id, status: systemPackageSubmissions.status })
        .from(systemPackageSubmissions).where(and(eq(systemPackageSubmissions.systemId, metadata.systemId),
          eq(systemPackageSubmissions.sha256, metadata.sha256), eq(systemPackageSubmissions.submittedById, user.id)))
        .orderBy(desc(systemPackageSubmissions.id)).limit(1);
      if (existing && ["pending", "published"].includes(existing.status)) {
        res.json({ id: existing.id, status: existing.status, ...metadata }); return;
      }
      const [{ id }] = await db.insert(systemPackageSubmissions).values({ ...metadata,
        packageJson: JSON.stringify(req.body.package), submittedById: user.id }).$returningId();
      await db.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id, action: "submitted", detailsJson: "{}" });
      res.status(201).json({ id, status: "pending", ...metadata });
    } catch (error) { res.status(error instanceof Error && error.message === "STORAGE_UNAVAILABLE" ? 503 : 400)
      .json({ error: error instanceof Error ? error.message : "INVALID_PACKAGE" }); }
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

  router.get("/admin/submissions", async (req, res) => {
    const user = await staff(req, res, true); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const rows = await db.select({ id: systemPackageSubmissions.id, systemId: systemPackageSubmissions.systemId,
      name: systemPackageSubmissions.name, sha256: systemPackageSubmissions.sha256, status: systemPackageSubmissions.status,
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
    res.json({ id: row.id, systemId: row.systemId, status: row.status, kind: value.kind,
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
      const audience = req.body?.audience as Audience;
      if (audience !== "all" && (!Array.isArray(audience) || !audience.length || audience.length > 1000
        || audience.some((id) => !Number.isInteger(id) || id <= 0))) { res.status(400).json({ error: "INVALID_AUDIENCE" }); return; }
      const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
      if (audience !== "all") {
        const existing = await db.select({ id: customers.id }).from(customers).where(eq(customers.isActive, true));
        if (audience.some((id) => !existing.some((row) => row.id === id))) { res.status(400).json({ error: "CUSTOMER_UNAVAILABLE" }); return; }
      }
      const id = Number(req.params.id);
      const [row] = await db.select().from(systemPackageSubmissions).where(eq(systemPackageSubmissions.id, id)).limit(1);
      if (!row || row.status !== "pending") { res.status(409).json({ error: "STATUS_CHANGED" }); return; }
      const keyPath = process.env.SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH;
      if (!keyPath) { res.status(503).json({ error: "SIGNING_KEY_UNCONFIGURED" }); return; }
      const signature = sign(null, Buffer.from(row.sha256, "hex"), readFileSync(keyPath, "utf8")).toString("base64");
      const result = await db.update(systemPackageSubmissions).set({ status: "published", reviewedById: user.id,
        audienceJson: JSON.stringify(audience), signature, publishedAt: new Date() })
        .where(and(eq(systemPackageSubmissions.id, id), eq(systemPackageSubmissions.status, "pending")));
      if (!result[0].affectedRows) { res.status(409).json({ error: "STATUS_CHANGED" }); return; }
      await db.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id, action: "published", detailsJson: JSON.stringify({ audience }) });
      res.json({ id, version: id, status: "published" });
    } catch { res.status(503).json({ error: "PUBLISH_FAILED" }); }
  });

  router.post("/admin/submissions/:id/revoke", async (req, res) => {
    const user = await staff(req, res, true); if (!user) return;
    const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
    const id = Number(req.params.id);
    const result = await db.update(systemPackageSubmissions).set({ status: "revoked" })
      .where(and(eq(systemPackageSubmissions.id, id), eq(systemPackageSubmissions.status, "published")));
    if (!result[0].affectedRows) { res.status(409).json({ error: "STATUS_CHANGED" }); return; }
    await db.insert(systemPackageEvents).values({ submissionId: id, actorId: user.id, action: "revoked", detailsJson: "{}" });
    res.json({ id, status: "revoked" });
  });

  router.get("/client/catalog", async (req, res) => {
    try {
      const customerId = await clientCustomer(req); if (!customerId) { res.status(403).json({ error: "LICENSE_UNAVAILABLE" }); return; }
      const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
      const rows = await db.select({ id: systemPackageSubmissions.id, systemId: systemPackageSubmissions.systemId,
        name: systemPackageSubmissions.name, sha256: systemPackageSubmissions.sha256,
        status: systemPackageSubmissions.status, audienceJson: systemPackageSubmissions.audienceJson,
        signature: systemPackageSubmissions.signature }).from(systemPackageSubmissions)
        .where(eq(systemPackageSubmissions.status, "published")).orderBy(desc(systemPackageSubmissions.id));
      const key = /^License ([a-fA-F0-9]{32,8192})$/.exec(req.get("authorization") || "")![1];
      const catalog = { issuedAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        keyHash: createHash("sha256").update(key).digest("hex"),
        systems: visibleReleases(rows, customerId).map((row) => ({ systemId: row.systemId, name: row.name,
          version: row.id, sha256: row.sha256, signature: row.signature })) };
      res.setHeader("Cache-Control", "no-store");
      res.json({ catalog, signature: signEnvelope(catalog) });
    } catch { res.status(503).json({ error: "CATALOG_UNAVAILABLE" }); }
  });

  router.get("/client/packages/:id/:version", async (req, res) => {
    try {
      const customerId = await clientCustomer(req); if (!customerId) { res.status(403).json({ error: "LICENSE_UNAVAILABLE" }); return; }
      const db = await getDb(); if (!db) { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return; }
      const [row] = await db.select().from(systemPackageSubmissions)
        .where(and(eq(systemPackageSubmissions.id, Number(req.params.version)), eq(systemPackageSubmissions.systemId, req.params.id),
          eq(systemPackageSubmissions.status, "published"))).limit(1);
      if (!row || !visibleReleases([row], customerId).length) { res.status(404).json({ error: "NOT_AVAILABLE" }); return; }
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
