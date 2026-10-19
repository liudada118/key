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

function releaseFiles(directory, relative = "") {
  const files = [];
  for (const name of readdirSync(path.join(directory, relative))) {
    const resource = relative ? `${relative}/${name}` : name;
    if (resource === "release.json") continue;
    if (name === "node_modules" || name.startsWith(".") || /[\\:\x00-\x1f]/.test(name)) throw new Error("Unexpected release resource");
    const target = path.join(directory, resource), stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error("Release resources cannot be symlinks");
    if (stat.isDirectory()) files.push(...releaseFiles(directory, resource));
    else if (stat.isFile()) files.push({ path: resource, bytes: stat.size,
      sha256: createHash("sha256").update(readFileSync(target)).digest("hex") });
    else throw new Error("Unexpected release resource");
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function writeReleaseManifest(directory, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid commit SHA");
  const manifest = { schemaVersion: 1, commit, nodeMajor: 22, files: releaseFiles(directory) };
  writeFileSync(path.join(directory, "release.json"), JSON.stringify(manifest));
  return { commit, files: manifest.files.length, bytes: manifest.files.reduce((sum, row) => sum + row.bytes, 0) };
}

export function verifyRelease(directory, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("Expected an exact commit SHA");
  const manifest = JSON.parse(readFileSync(path.join(directory, "release.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.commit !== commit || manifest.nodeMajor !== 22
    || Number(process.versions.node.split(".")[0]) < manifest.nodeMajor) throw new Error("Release identity or Node version mismatch");
  const files = releaseFiles(directory);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) throw new Error("Release resource checksum mismatch");
  const required = ["index.js", "migrate.js", "package.json", "public/index.html", "config/licenseSensorGroups.json", "drizzle/meta/_journal.json"];
  if (required.some(name => !files.some(row => row.path === name && row.bytes > 0))) throw new Error("Incomplete release");
  return { files: files.length, bytes: files.reduce((sum, row) => sum + row.bytes, 0) };
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
    for (const name of ["key-manager-build.tgz", "key-manager-build.tgz.sha256", "staging", "health-index.html", "health.json"]) {
      const target = path.join(deploymentDirectory(base, current), name);
      if (existsSync(target) && !lstatSync(target).isSymbolicLink()) rmSync(target, { recursive: true });
    }
  }
  return { removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, root, directory, state] = process.argv.slice(2);
  if (command === "fingerprint") console.log(dependencyFingerprint(root));
  else if (command === "verify") console.log(JSON.stringify(verifyRelease(root, directory)));
  else if (command === "health") {
    const response = JSON.parse(readFileSync(root, "utf8"));
    if (response.ok !== true || response.commit !== directory) throw new Error("Running release mismatch");
  }
  else if (command === "record") recordDeployment(root, directory, state);
  else if (command === "cleanup") console.log(JSON.stringify(cleanupDeployments(root, directory)));
  else throw new Error("Expected fingerprint, record or cleanup");
}
