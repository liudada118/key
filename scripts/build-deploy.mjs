import { build } from "esbuild";
import { builtinModules } from "node:module";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeReleaseManifest } from "./deploy-maintenance.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

export async function buildDeployRelease(destination, commit, sourceRoot = projectRoot, publicDirectory = path.join(sourceRoot, "dist/public")) {
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("Expected an exact Git commit SHA");
  const output = path.resolve(destination);
  if (existsSync(output)) throw new Error("Release output must not already exist");
  const dist = path.join(output, "dist");
  mkdirSync(dist, { recursive: true });
  const result = await build({ absWorkingDir: sourceRoot,
    entryPoints: { index: "server/_core/index.ts", migrate: "scripts/migrate-production.ts" },
    outdir: dist, bundle: true, platform: "node", target: "node22", format: "esm", metafile: true,
    define: { "process.env.NODE_ENV": '"production"', "process.env.KEY_MANAGER_BUILD_SHA": JSON.stringify(commit) },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    logLevel: "warning",
  });
  for (const row of Object.values(result.metafile.outputs)) for (const dependency of row.imports) {
    if (dependency.external && !builtins.has(dependency.path)) throw new Error(`Unbundled runtime dependency: ${dependency.path}`);
  }
  if (Object.keys(result.metafile.inputs).some(file => /node_modules[\\/](vite|typescript|drizzle-kit)[\\/]/.test(file))) {
    throw new Error("Development tooling was included in the production release");
  }
  function copy(from, to) {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error("Release inputs cannot be symlinks");
    if (stat.isDirectory()) {
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from)) {
        if (!name.startsWith(".")) copy(path.join(from, name), path.join(to, name));
      }
    } else if (stat.isFile()) {
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(from, to);
    }
    else throw new Error("Unsupported release input");
  }
  copy(publicDirectory, path.join(dist, "public"));
  copy(path.join(sourceRoot, "config/licenseSensorGroups.json"), path.join(dist, "config/licenseSensorGroups.json"));
  copy(path.join(sourceRoot, "config/agent-model-catalog.json"), path.join(dist, "config/agent-model-catalog.json"));
  const journalPath = path.join(sourceRoot, "drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  copy(journalPath, path.join(dist, "drizzle/meta/_journal.json"));
  for (const row of journal.entries) {
    if (!/^\d{4}_[A-Za-z0-9_-]+$/.test(row.tag)) throw new Error("Unsafe migration name");
    copy(path.join(sourceRoot, "drizzle", `${row.tag}.sql`), path.join(dist, "drizzle", `${row.tag}.sql`));
  }
  writeFileSync(path.join(dist, "package.json"), JSON.stringify({ private: true, type: "module" }));
  return writeReleaseManifest(dist, commit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [destination, commit] = process.argv.slice(2);
  if (!destination) throw new Error("Expected output directory and commit SHA");
  console.log(JSON.stringify(await buildDeployRelease(destination, commit)));
}
