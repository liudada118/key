import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, ".local/mysql.json"), "utf8"));
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "key-usage-v2-mysql-"));
let server, connection;

/** Run a bounded child process with inherited test output and no visible helper window. */
async function run(executable, args, options = {}) {
  const child = spawn(executable, args, { cwd: root, stdio: "inherit", windowsHide: true, ...options });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Child failed (${code})`)));
  });
}

/** Allocate a temporary loopback port without using the configured business database port. */
async function availablePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

try {
  const port = await availablePort();
  const baseArgs = ["--no-defaults", `--basedir=${config.baseDirectory}`, `--datadir=${temporaryRoot}`,
    "--innodb-buffer-pool-size=32M", "--innodb-redo-log-capacity=64M"];
  await run(config.binaryPath, [...baseArgs, "--initialize-insecure", `--log-error=${path.join(temporaryRoot, "initialize.log")}`], { timeout: 60000 });
  server = spawn(config.binaryPath, [...baseArgs, `--port=${port}`, "--bind-address=127.0.0.1", "--mysqlx=0",
    "--skip-log-bin", "--performance-schema=OFF", "--max-connections=20", `--log-error=${path.join(temporaryRoot, "server.log")}`],
  { stdio: "ignore", windowsHide: true });
  const url = `mysql://root@127.0.0.1:${port}/`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { connection = await mysql.createConnection({ uri: url, connectTimeout: 500 }); break; }
    catch { if (server.exitCode !== null) throw new Error("Temporary MySQL exited"); await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  if (!connection) throw new Error("Temporary MySQL startup timed out");
  await run(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "server/usage.integration.test.ts"],
    { env: { ...process.env, USAGE_TEST_ADMIN_URL: url }, timeout: 120000 });
} finally {
  if (connection) { try { await connection.query("SHUTDOWN"); } catch {} await connection.end(); }
  if (server && server.exitCode === null) {
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (server.exitCode === null) server.kill();
  }
  const resolved = path.resolve(temporaryRoot), base = path.resolve(tmpdir());
  if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith("key-usage-v2-mysql-")) throw new Error("Unsafe temporary cleanup target");
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
