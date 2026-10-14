import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./db", () => ({ getDb: async () => testDb }));
import { authorizeLicenseDevice, changeLicenseDevice } from "./licenseDevices";
const adminUrl = process.env.DEVICES_TEST_ADMIN_URL || process.env.USAGE_TEST_ADMIN_URL;

describe.skipIf(!adminUrl)("computer activation MySQL locking", () => {
  const databaseName = `devices_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Connection, pool: Pool, root: string;
  const key = { id: 1, keyString: "ab".repeat(64), expireTimestamp: Date.now() + 86400000 };
  const a = "a".repeat(64), b = "b".repeat(64);
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`; pool = mysql.createPool({ uri: url.toString(), connectionLimit: 8 }); testDb = drizzle(pool);
    for (const statement of readFileSync(new URL("../drizzle/0020_license_device_limits.sql", import.meta.url), "utf8").split("--> statement-breakpoint")) await pool.query(statement);
    await pool.query("INSERT INTO license_device_policies (key_type,key_id,max_devices) VALUES ('online',1,1)");
    root = mkdtempSync(path.join(tmpdir(), "devices-signing-test-"));
    const keyPath = path.join(root, "test.pem");
    writeFileSync(keyPath, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
    vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", keyPath);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); await admin.end(); }
    if (root) rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs();
  });

  it("only one of two simultaneous new computers gets the last slot", async () => {
    const results = await Promise.all([authorizeLicenseDevice(key, a), authorizeLicenseDevice(key, b)]);
    expect(results.filter(result => result.allowed)).toHaveLength(1);
    expect(results.filter(result => result.code === "DEVICE_LIMIT_REACHED")).toHaveLength(1);
    const registered = results[0].allowed ? a : b;
    expect((await authorizeLicenseDevice(key, registered)).code).toBe("REGISTERED");
  });

  it("revoking frees the slot and a revoked computer cannot silently reclaim it", async () => {
    const [rows] = await pool.query("SELECT device_id FROM license_devices WHERE key_id=1 AND status='active'");
    const registered = (rows as { device_id: string }[])[0].device_id, other = registered === a ? b : a;
    await changeLicenseDevice(1, registered, "revoked");
    expect((await authorizeLicenseDevice(key, registered)).code).toBe("DEVICE_REVOKED");
    expect((await authorizeLicenseDevice(key, other)).allowed).toBe(true);
    await expect(changeLicenseDevice(1, registered, "active")).rejects.toThrow();
  });
});
