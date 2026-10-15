import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MARKER = ".key-manager-deployment.json";
const STATES = new Set(["prepared", "success", "failed"]);

function deploymentDirectory(root, directory) {
  const base = realpathSync(root);
  const target = path.resolve(directory);
  if (path.dirname(target) !== base || !/^\d+-\d+$/.test(path.basename(target))
    || !lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink() || realpathSync(target) !== target) {
    throw new Error("Deployment path must be a real run-attempt directory directly inside its managed root");
  }
  return target;
}

/** Cache installation only for the same manifests, patches, configuration and Node version. */
export function dependencyFingerprint(directory, nodeVersion = process.versions.node) {
  const hash = createHash("sha256").update(nodeVersion);
  function add(relative) {
    const target = path.join(directory, relative);
    if (!existsSync(target)) return;
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error("Dependency inputs cannot be symlinks");
    if (stat.isDirectory()) {
      for (const name of readdirSync(target).sort()) add(path.join(relative, name));
    } else {
      hash.update(relative.replaceAll(path.sep, "/")).update("\0").update(readFileSync(target)).update("\0");
    }
  }
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs", "patches"]) add(file);
  return hash.digest("hex");
}

export function recordDeployment(root, directory, state, now = Date.now()) {
  if (!STATES.has(state)) throw new Error("Invalid deployment state");
  const target = deploymentDirectory(root, directory);
  const marker = path.join(target, MARKER);
  if (existsSync(marker) && lstatSync(marker).isSymbolicLink()) throw new Error("Invalid deployment marker");
  writeFileSync(marker, JSON.stringify({ schemaVersion: 1, state, updatedAt: now }), { mode: 0o600 });
}

/** Only owned, marked directories are eligible; current and recent rollback evidence remain intact. */
export function cleanupDeployments(root, currentDirectory, now = Date.now()) {
  const base = realpathSync(root);
  const current = deploymentDirectory(base, currentDirectory);
  const records = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^\d+-\d+$/.test(entry.name)) continue;
    const directory = deploymentDirectory(base, path.join(base, entry.name));
    try {
      const marker = path.join(directory, MARKER);
      if (lstatSync(marker).isSymbolicLink()) continue;
      const value = JSON.parse(readFileSync(marker, "utf8"));
      if (value.schemaVersion === 1 && STATES.has(value.state) && Number.isFinite(value.updatedAt)) {
        records.push({ directory, state: value.state, updatedAt: value.updatedAt });
      }
    } catch { /* Unmarked directories belong to the operator, not this cleanup policy. */ }
  }
  records.sort((a, b) => b.updatedAt - a.updatedAt || b.directory.localeCompare(a.directory));
  const keep = new Set([current]);
  for (const [state, count] of [["success", 2], ["failed", 1]]) {
    for (const item of records.filter(item => item.state === state).slice(0, count)) keep.add(item.directory);
  }
  let removed = 0;
  for (const item of records) {
    if (keep.has(item.directory) || (item.state === "prepared" && now - item.updatedAt < 86400000)) continue;
    rmSync(deploymentDirectory(base, item.directory), { recursive: true });
    removed++;
  }
  const active = records.find(item => item.directory === current);
  const bootstrap = path.join(current, "bootstrap.env");
  if (existsSync(bootstrap) && !lstatSync(bootstrap).isSymbolicLink()) rmSync(bootstrap);
  if (active?.state === "success") {
    for (const name of ["key-manager-build.tgz", "key-manager-build.tgz.sha256", "staging", "health-index.html"]) {
      const target = path.join(deploymentDirectory(base, current), name);
      if (existsSync(target) && !lstatSync(target).isSymbolicLink()) rmSync(target, { recursive: true });
    }
  }
  return { removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, root, directory, state] = process.argv.slice(2);
  if (command === "fingerprint") console.log(dependencyFingerprint(root));
  else if (command === "record") recordDeployment(root, directory, state);
  else if (command === "cleanup") console.log(JSON.stringify(cleanupDeployments(root, directory)));
  else throw new Error("Expected fingerprint, record or cleanup");
}
