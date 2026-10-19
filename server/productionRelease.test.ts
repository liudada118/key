import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDeployRelease } from "../scripts/build-deploy.mjs";
import { verifyRelease } from "../scripts/deploy-maintenance.mjs";

const exec = promisify(execFile);
const adminUrl = process.env.CUSTOMER_SYNC_TEST_ADMIN_URL;
const commit = "a".repeat(40);

describe("self-contained production release", () => {
  let root: string, dist: string, marker: string, child: ChildProcess | undefined, admin: Connection | undefined;
  let endpoint: string, env: NodeJS.ProcessEnv, buildResult: { files: number; bytes: number };
  const database = `deployment_bundle_test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "key-production-release-"));
    const publicRoot = path.join(root, "public-fixture"); mkdirSync(publicRoot);
    writeFileSync(path.join(publicRoot, "index.html"), "<!doctype html><title>Isolated release fixture</title>");
    buildResult = await buildDeployRelease(path.join(root, "release"), commit, path.resolve(import.meta.dirname, ".."), publicRoot);
    dist = path.join(root, "release/dist"); marker = path.join(root, "migrations.sha256");
    mkdirSync(path.join(root, "config"));
    writeFileSync(path.join(root, "config/licenseSensorGroups.json"), "invalid old checkout registry");
    env = { ...process.env, NODE_PATH: "", NODE_ENV: "production", LICENSE_REGISTRY_PATH: "",
      JWT_SECRET: "synthetic-release-test-secret-32-characters", DATABASE_URL: "mysql://root@127.0.0.1:1/unavailable" };
    if (adminUrl) {
      const url = new URL(adminUrl);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
      admin = await mysql.createConnection(adminUrl);
      await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
      url.pathname = `/${database}`; env.DATABASE_URL = url.toString();
      await exec(process.execPath, [path.join(dist, "migrate.js"), marker], { cwd: root, env, timeout: 30000 });
    }
    const listener = createServer();
    await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>(resolve => listener.close(() => resolve()));
    endpoint = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(dist, "index.js")], { cwd: root, env: { ...env, PORT: String(port) }, windowsHide: true, stdio: "ignore" });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${endpoint}/healthz`)).ok) return; } catch { /* Wait for the isolated listener. */ }
      if (child.exitCode !== null) throw new Error("Standalone release exited before becoming healthy");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Standalone release did not become ready");
  }, 45000);
  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child!.once("exit", resolve)); child.kill(); await exited;
    }
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end(); }
    if (root && path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith("key-production-release-")) rmSync(root, { recursive: true, force: true });
  });
  it("bundles actual runtime dependencies into a small fixed file set, outside the project", () => {
    expect(buildResult.files).toBeLessThan(100);
    expect(buildResult.bytes).toBeLessThan(12 * 1024 * 1024);
    expect(verifyRelease(dist, commit).files).toBe(buildResult.files);
    expect(existsSync(path.join(root, "node_modules"))).toBe(false);
    expect(existsSync(path.join(dist, "node_modules"))).toBe(false);
  });
  it("serves the exact commit, static HTML and public registry without a package manager", async () => {
    const health = await fetch(`${endpoint}/healthz`);
    expect(await health.json()).toEqual({ ok: true, commit });
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(await (await fetch(endpoint)).text()).toContain("Isolated release fixture");
    expect(await (await fetch(`${endpoint}/sensorTypes`)).json()).toHaveProperty("registrySha256");
  });
  it.skipIf(!adminUrl)("executes the complete SQL history once and reuses the target-bound marker", async () => {
    const result = await exec(process.execPath, [path.join(dist, "migrate.js"), marker], { cwd: root, env, timeout: 10000 });
    expect(result.stdout).toContain("unchanged; skipped");
    const [rows] = await admin!.query(`SELECT COUNT(*) AS n FROM \`${database}\`.__drizzle_migrations`);
    expect(Number((rows as { n: number }[])[0].n)).toBe(22);
    const changed = await exec(process.execPath, [path.join(dist, "migrate.js"), marker], { cwd: root, env: { ...env, DATABASE_URL: `${env.DATABASE_URL}?charset=utf8mb4` }, timeout: 10000 });
    expect(changed.stdout).toContain("Completed");
    const forced = await exec(process.execPath, [path.join(dist, "migrate.js"), marker, "--force"], { cwd: root, env: { ...env, DATABASE_URL: `${env.DATABASE_URL}?charset=utf8mb4` }, timeout: 10000 });
    expect(forced.stdout).toContain("Completed");
  });
  it.skipIf(!adminUrl)("authenticates through bundled bcrypt, MySQL, cookies and JWT", async () => {
    const response = await fetch(`${endpoint}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, user: { role: "super_admin" } });
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });
  it.skipIf(!adminUrl)("does not mark a failed migration as reusable or print the database URL", async () => {
    const journalPath = path.join(dist, "drizzle/meta/_journal.json"), original = readFileSync(journalPath, "utf8");
    const before = readFileSync(marker, "utf8");
    const journal = JSON.parse(original);
    journal.entries.push({ idx: 22, version: "5", when: Date.now() + 86400000, tag: "9999_synthetic_failure", breakpoints: true });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(path.join(dist, "drizzle/9999_synthetic_failure.sql"), "SYNTHETIC INVALID SQL");
    try {
      await expect(exec(process.execPath, [path.join(dist, "migrate.js"), marker], { cwd: root, env, timeout: 10000 }))
        .rejects.toMatchObject({ code: 1, stderr: expect.not.stringContaining(env.DATABASE_URL!) });
      expect(readFileSync(marker, "utf8")).toBe(before);
    } finally {
      writeFileSync(journalPath, original); rmSync(path.join(dist, "drizzle/9999_synthetic_failure.sql"));
    }
  });
});
