import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureLocalMysql } from "../scripts/ensure-local-mysql.mjs";

let directory: string;
const config = { schemaVersion: 1, binaryPath: "C:\\MySQL\\bin\\mysqld.exe", baseDirectory: "C:\\MySQL",
  dataDirectory: "E:\\local-data", port: 3307, startupTimeoutSeconds: 45 };
const databaseUrl = "mysql://test:test-only@127.0.0.1:3307/local_fixture";
const refused = () => Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
function fixture() {
  const configPath = path.join(directory, "mysql.json");
  writeFileSync(configPath, JSON.stringify(config));
  return { platform: "win32", databaseUrl, configPath, probeDatabase: vi.fn().mockResolvedValue(undefined), startDatabase: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), "key-local-mysql-test-")); });
afterEach(() => {
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("key-local-mysql-test-")) throw new Error("Unsafe temporary directory");
  rmSync(directory, { recursive: true, force: true });
});

describe("opt-in local MySQL startup", () => {
  it("does nothing on Linux even with a local configuration", async () => {
    const deps = fixture();
    expect(await ensureLocalMysql({ ...deps, platform: "linux" })).toEqual({ state: "skipped", reason: "not-windows" });
    expect(deps.probeDatabase).not.toHaveBeenCalled(); expect(deps.startDatabase).not.toHaveBeenCalled();
  });
  it("does nothing when the machine has not opted in", async () => {
    const deps = fixture();
    expect(await ensureLocalMysql({ ...deps, configPath: path.join(directory, "absent.json") })).toEqual({ state: "skipped", reason: "not-configured" });
    expect(deps.startDatabase).not.toHaveBeenCalled();
  });
  it.each(["mysql://test@database.example:3307/test", "mysql://test@127.0.0.1:3306/test", "https://127.0.0.1:3307/test"])("never starts for a different target: %s", async url => {
    const deps = fixture();
    expect(await ensureLocalMysql({ ...deps, databaseUrl: url })).toEqual({ state: "skipped", reason: "different-database-target" });
    expect(deps.probeDatabase).not.toHaveBeenCalled(); expect(deps.startDatabase).not.toHaveBeenCalled();
  });
  it("does not start another process when authentication and ping succeed", async () => {
    const deps = fixture();
    expect(await ensureLocalMysql(deps)).toEqual({ state: "ready" });
    expect(deps.startDatabase).not.toHaveBeenCalled();
  });
  it("starts once only after connection refusal, then verifies database access", async () => {
    const deps = fixture();
    deps.probeDatabase.mockRejectedValueOnce(refused());
    expect(await ensureLocalMysql(deps)).toEqual({ state: "started" });
    expect(deps.startDatabase).toHaveBeenCalledTimes(1);
    expect(deps.startDatabase).toHaveBeenCalledWith(deps.configPath, 45);
    expect(deps.probeDatabase).toHaveBeenCalledTimes(2);
    expect(deps.probeDatabase).toHaveBeenLastCalledWith(databaseUrl);
  });
  it.each(["ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ETIMEDOUT"])("never restarts or initializes MySQL on %s", async code => {
    const deps = fixture();
    deps.probeDatabase.mockRejectedValue(Object.assign(new Error("test error"), { code }));
    await expect(ensureLocalMysql(deps)).rejects.toMatchObject({ code });
    expect(deps.startDatabase).not.toHaveBeenCalled();
  });
  it("fails rather than starting the app if access is still unavailable", async () => {
    const deps = fixture();
    deps.probeDatabase.mockRejectedValue(refused());
    await expect(ensureLocalMysql(deps)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(deps.startDatabase).toHaveBeenCalledTimes(1);
  });
  it("propagates startup failure without retrying another data directory", async () => {
    const deps = fixture();
    deps.probeDatabase.mockRejectedValueOnce(refused());
    deps.startDatabase.mockRejectedValue(new Error("missing existing data"));
    await expect(ensureLocalMysql(deps)).rejects.toThrow("missing existing data");
    expect(deps.startDatabase).toHaveBeenCalledTimes(1);
    expect(deps.probeDatabase).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid configuration before touching a process or a database", async () => {
    const deps = fixture();
    writeFileSync(deps.configPath, JSON.stringify({ ...config, port: 0, initialize: true }));
    await expect(ensureLocalMysql(deps)).rejects.toThrow();
    expect(deps.probeDatabase).not.toHaveBeenCalled(); expect(deps.startDatabase).not.toHaveBeenCalled();
  });
});
