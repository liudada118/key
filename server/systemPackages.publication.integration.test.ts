import { randomUUID, createHash, generateKeyPairSync } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { createServer, type Server } from "node:http";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;
const principal = vi.hoisted(() => ({ role: "super_admin" }));
vi.mock("./db", () => ({ getDb: async () => testDb }));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: async () => ({ id: 7, role: principal.role, isActive: true }) } }));
import { registerSystemPackages, rolloutToken } from "./systemPackages";
const adminUrl = process.env.SYSTEM_PACKAGE_TEST_ADMIN_URL;

describe.skipIf(!adminUrl)("candidate publication MySQL transactions", () => {
  let admin: Connection, pool: Pool, server: Server, base: string, scratch: string;
  const databaseName = `publication_test_${randomUUID().replaceAll("-", "")}`;
  /** Read only the local isolated test database. */
  async function rows(query: string, args: unknown[] = []) { return (await pool.query<RowDataPacket[]>(query, args))[0]; }
  /** Insert an immutable synthetic template package without customer data. */
  async function seed(systemId: string, status: "pending" | "published", baseVersion?: number) {
    const payload = { schemaVersion: 1, kind: "native-template", systemId,
      template: { id: systemId, name: systemId, sourceType: "hand", configuration: { algorithms: [], charts: [] } }, algorithms: [] };
    const sha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const [result] = await pool.execute<any>("INSERT INTO system_package_submissions (system_id,name,sha256,package_json,status,submitted_by_id,base_version) VALUES (?,?,?,?,?,7,?)",
      [systemId, systemId, sha256, JSON.stringify({ ...payload, sha256 }), status, baseVersion ?? null]);
    return result.insertId as number;
  }
  /** Send one authenticated review action to the real local router. */
  async function post(route: string, body: unknown) {
    const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    url.pathname = `/${databaseName}`; pool = mysql.createPool({ uri: url.toString(), connectionLimit: 8 }); testDb = drizzle(pool);
    for (const file of ["0016_kind_puma.sql", "0018_brief_fixer.sql", "0019_handy_gwen_stacy.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
    }
    scratch = await mkdtemp(path.join(tmpdir(), "key-publication-test-"));
    const key = generateKeyPairSync("ed25519"); const signingPath = path.join(scratch, "signing.pem");
    await writeFile(signingPath, key.privateKey.export({ type: "pkcs8", format: "pem" }));
    vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", signingPath);
    const app = express(); registerSystemPackages(app); server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("MISSING_TEST_ADDRESS");
    base = `http://127.0.0.1:${address.port}/api/system-packages`;
  });
  afterAll(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve())); await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); await admin.end(); }
    if (scratch) await rm(scratch, { recursive: true, force: true }); vi.unstubAllEnvs();
  });
  it("establishes the first default and does not promote an approved update even from a legacy all-audience request", async () => {
    const first = await seed("candidate-test", "pending");
    expect((await post(`/admin/submissions/${first}/publish`, {})).status).toBe(200);
    await pool.query("INSERT INTO system_package_rollouts VALUES ('candidate-test',42,?,7,NOW())", [first]);
    const next = await seed("candidate-test", "pending", first);
    expect((await post(`/admin/submissions/${next}/publish`, { audience: "all", confirmBaseVersion: first })).status).toBe(200);
    const pointers = await rows("SELECT * FROM system_package_rollouts WHERE system_id='candidate-test' ORDER BY customer_id");
    expect(pointers.map(item => [item.customer_id, item.version_id])).toEqual([[0, first], [42, first]]);
    const token = rolloutToken(pointers.map(item => ({ systemId: item.system_id, customerId: item.customer_id, versionId: item.version_id })));
    expect((await post(`/admin/releases/${next}/activate`, { audience: "all", expectedRolloutToken: token })).status).toBe(200);
    expect((await rows("SELECT * FROM system_package_rollouts WHERE system_id='candidate-test'")).map(item => [item.customer_id, item.version_id])).toEqual([[0, next]]);
    expect((await post(`/admin/releases/${first}/activate`, { audience: "all", expectedRolloutToken: token })).status).toBe(409);
  });
  it("backfills the previous legacy default within approval and preserves customer overrides", async () => {
    const old = await seed("legacy-test", "published");
    await pool.query("INSERT INTO system_package_rollouts VALUES ('legacy-test',42,?,7,NOW())", [old]);
    const next = await seed("legacy-test", "pending", old);
    expect((await post(`/admin/submissions/${next}/publish`, { audience: [42], confirmBaseVersion: old })).status).toBe(200);
    expect((await rows("SELECT * FROM system_package_rollouts WHERE system_id='legacy-test' ORDER BY customer_id"))
      .map(item => [item.customer_id, item.version_id])).toEqual([[0, old], [42, old]]);
  });
  it("stores an explicit version withdrawal and audits later policy changes without moving pointers", async () => {
    const version = await seed("withdraw-test", "pending");
    expect((await post(`/admin/submissions/${version}/publish`, {})).status).toBe(200);
    expect((await post(`/admin/submissions/${version}/revoke`, { withdrawalMode: "stop-new-acquisition", reason: "synthetic" })).status).toBe(200);
    const [release] = await rows("SELECT * FROM system_package_submissions WHERE id=?", [version]);
    expect(release.status).toBe("revoked");
    const [pointer] = await rows("SELECT * FROM system_package_rollouts WHERE system_id='withdraw-test'");
    expect(pointer.version_id).toBe(version);
    expect((await post(`/admin/submissions/${version}/revoke`, {})).status).toBe(409);
    expect((await post(`/admin/submissions/${version}/revoke`, { withdrawalMode: "stop-distribution" })).status).toBe(200);
    const events = await rows("SELECT * FROM system_package_events WHERE submission_id=? AND action IN ('revoked','withdrawal-policy') ORDER BY id", [version]);
    expect(events.map(event => JSON.parse(event.details_json).withdrawal.mode)).toEqual(["stop-new-acquisition", "stop-distribution"]);
    expect((await post(`/admin/submissions/${version}/revoke`, { withdrawalMode: "unexpected" })).status).toBe(400);
  });
  it("preserves a withdrawn legacy baseline and identity contract instead of treating its replacement as a first publication", async () => {
    const old = await seed("withdrawn-legacy", "published");
    await pool.query("UPDATE system_package_submissions SET status='revoked' WHERE id=?", [old]);
    const next = await seed("withdrawn-legacy", "pending", old);
    expect((await post(`/admin/submissions/${next}/publish`, { confirmBaseVersion: old })).status).toBe(200);
    const [pointer] = await rows("SELECT * FROM system_package_rollouts WHERE system_id='withdrawn-legacy'");
    expect(pointer.version_id).toBe(old);
    const [event] = await rows("SELECT * FROM system_package_events WHERE submission_id=? AND action='published'", [next]);
    expect(JSON.parse(event.details_json).firstPublication).toBe(false);
  });
  it("reserves publishing and explicit promotion for super administrators", async () => {
    principal.role = "admin";
    expect((await post("/admin/submissions/1/publish", {})).status).toBe(403);
    expect((await post("/admin/releases/1/activate", {})).status).toBe(403);
    principal.role = "super_admin";
  });
});
