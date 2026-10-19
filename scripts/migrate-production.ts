import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/mysql2/migrator";

export async function migrateProduction(folder: string, marker: string, databaseUrl: string, force = false) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  // Bind reuse to both the exact SQL history and target, without persisting credentials.
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: 1, target: databaseUrl,
    migrations: migrations.map(row => [row.folderMillis, row.hash]) })).digest("hex");
  if (!force && existsSync(marker) && readFileSync(marker, "utf8").trim() === fingerprint) return { skipped: true };
  const connection = await mysql.createConnection({ uri: databaseUrl, connectTimeout: 10000 });
  try {
    await migrate(drizzle(connection), { migrationsFolder: folder });
    const scratch = `${marker}.${randomUUID()}.tmp`;
    try {
      writeFileSync(scratch, `${fingerprint}\n`, { mode: 0o600, flag: "wx" });
      renameSync(scratch, marker);
    } finally { rmSync(scratch, { force: true }); }
    return { skipped: false };
  } finally { await connection.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const marker = process.argv[2];
  if (!marker || !path.isAbsolute(marker)) throw new Error("An absolute migration marker path is required");
  migrateProduction(path.join(import.meta.dirname, "drizzle"), marker, process.env.DATABASE_URL || "", process.argv.includes("--force"))
    .then(result => console.log(result.skipped ? "[Migrate] SQL and database target unchanged; skipped" : "[Migrate] Completed"))
    .catch(error => {
      const code = String(error.code || error.cause?.code || "MIGRATION_FAILED").replace(/[^A-Z0-9_]/g, "");
      console.error(`[Migrate] Failed: ${code || "MIGRATION_FAILED"}. No success marker written.`);
      process.exitCode = 1;
    });
}
