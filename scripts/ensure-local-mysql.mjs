import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configSchema = z.object({
  schemaVersion: z.literal(1), binaryPath: z.string().min(1), baseDirectory: z.string().min(1),
  dataDirectory: z.string().min(1), port: z.number().int().min(1024).max(65535),
  startupTimeoutSeconds: z.number().int().min(5).max(60),
}).strict();

async function probe(databaseUrl) {
  const connection = await mysql.createConnection({ uri: databaseUrl, connectTimeout: 3000 });
  try { await connection.ping(); } finally { await connection.end(); }
}

async function start(configPath, timeoutSeconds) {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  await new Promise((resolve, reject) => {
    // MySQL outlives the helper; inherited stdout pipes must not keep Node waiting for it.
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
      "-ExecutionPolicy", "RemoteSigned", "-File", path.join(root, "scripts/start-local-mysql.ps1"),
      "-ConfigPath", configPath], { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error("Local MySQL helper timed out"), { code: "LOCAL_MYSQL_START_TIMEOUT" }));
    }, (timeoutSeconds * 2 + 15) * 1000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Object.assign(new Error("Local MySQL helper failed"), { code: "LOCAL_MYSQL_START_FAILED" }));
    });
  });
}

/** Local opt-in only: never starts a database for Linux, a remote URL, or a mismatched port. */
export async function ensureLocalMysql({ platform = process.platform, databaseUrl = process.env.DATABASE_URL,
  configPath = path.join(root, ".local/mysql.json"), probeDatabase = probe, startDatabase = start } = {}) {
  if (platform !== "win32") return { state: "skipped", reason: "not-windows" };
  if (!existsSync(configPath)) return { state: "skipped", reason: "not-configured" };
  const config = configSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
  const target = new URL(databaseUrl || "");
  if (target.protocol !== "mysql:" || !["127.0.0.1", "localhost"].includes(target.hostname)
    || Number(target.port || 3306) !== config.port) return { state: "skipped", reason: "different-database-target" };
  try {
    await probeDatabase(databaseUrl);
    return { state: "ready" };
  } catch (error) {
    if (error.code !== "ECONNREFUSED") throw error;
  }
  await startDatabase(configPath, config.startupTimeoutSeconds);
  await probeDatabase(databaseUrl);
  return { state: "started" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  dotenv.config({ path: path.join(root, ".env"), quiet: true });
  ensureLocalMysql().then(result => {
    if (result.state !== "skipped") console.log(`[Local MySQL] ${result.state}; existing data and credentials preserved.`);
  }).catch(error => {
    const code = String(error.code || "LOCAL_MYSQL_START_FAILED").replace(/[^A-Z0-9_]/g, "") || "LOCAL_MYSQL_START_FAILED";
    console.error(`[Local MySQL] ${code}. Check .local/mysql.json and the startup logs; no database was initialized or reset.`);
    process.exitCode = 1;
  });
}
