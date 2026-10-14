import { createHash, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { closeSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Resource = { path: string; size: number; sha256: string };
type Release = { manifest: { releaseId: number; files: Resource[] }; signature: string };

/** Recheck the latest publication before using it as an immutable resource source. */
function readLatest(destination: string, signingKey: Buffer): Release | null {
  const pointer = path.join(destination, "latest.json");
  if (!existsSync(pointer)) return null;
  const envelope = JSON.parse(readFileSync(pointer, "utf8")) as Release;
  if (!Number.isSafeInteger(envelope.manifest?.releaseId) || envelope.manifest.releaseId < 1
    || !Array.isArray(envelope.manifest.files)
    || !verify(null, Buffer.from(JSON.stringify(envelope.manifest)), createPublicKey(signingKey), Buffer.from(envelope.signature, "base64"))) throw new Error("Invalid latest frontend release");
  return envelope;
}

/** Keep five recent releases and a 24-hour download grace period, always protecting latest. */
export function cleanupFrontendReleases(destination: string, latestId: number, now = Date.now()) {
  const root = path.resolve(destination);
  const releases = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^[1-9]\d{0,15}$/.test(entry.name))
    .sort((a, b) => Number(b.name) - Number(a.name));
  const keep = new Set([String(latestId), ...releases.slice(0, 5).map(entry => entry.name)]);
  let removed = 0;
  for (const entry of releases) {
    const target = path.resolve(root, entry.name);
    if (keep.has(entry.name) || path.dirname(target) !== root || now - lstatSync(target).mtimeMs < 24 * 60 * 60 * 1000) continue;
    try { rmSync(target, { recursive: true, force: true }); removed++; } catch { /* Retry locks during the next publication. */ }
  }
  return removed;
}

/** Link previously published, hash-verified bytes; never link mutable upload source files. */
function reusePublishedResource(destination: string, latest: Release | null, file: Resource, target: string) {
  const candidate = latest?.manifest.files.find(previous => previous.sha256 === file.sha256 && previous.size === file.size);
  if (!candidate || !latest) return false;
  const base = path.resolve(destination, String(latest.manifest.releaseId)), from = path.resolve(base, candidate.path);
  if (!from.startsWith(base + path.sep)) return false;
  try {
    let current = base;
    for (const part of candidate.path.split("/")) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) return false;
    }
    const stat = lstatSync(from);
    if (!stat.isFile() || stat.size !== file.size || createHash("sha256").update(readFileSync(from)).digest("hex") !== file.sha256) return false;
    try { linkSync(from, target); } catch { cpSync(from, target); }
    return true;
  } catch { return false; }
}

/** Publish a complete built webpage using the existing server signing key, without changing an installer. */
export function publishFrontend(buildDirectory: string, minimumVersion: string, destination: string, keyPath: string, requestedId?: string) {
  if (!buildDirectory || !/^\d+\.\d+\.\d+$/.test(minimumVersion || "") || !destination || !keyPath) throw new Error("Provide build directory, minimum app version, and both publication environment variables.");
  const releaseId = requestedId ? Number(requestedId) : Date.now();
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error("Invalid release ID");
  const source = path.resolve(buildDirectory), root = path.resolve(destination), target = path.join(root, String(releaseId));
  if (source === root || root.startsWith(source + path.sep) || source.startsWith(root + path.sep) || existsSync(target)) throw new Error("Publication paths overlap or this release already exists.");
  const build = JSON.parse(readFileSync(path.join(source, "frontend-build.json"), "utf8"));
  if (build.schemaVersion !== 1 || !Number.isSafeInteger(build.buildId) || build.buildId < 1
    || !/^\d+\.\d+\.\d+$/.test(build.appVersion || "")) throw new Error("Missing valid frontend build metadata; rebuild Shroom before publishing.");
  const files: Resource[] = [];
  /** Heavy model directories remain supplied by the compatible installer, not mixed executable web releases. */
  function walk(relative = "") {
    for (const entry of readdirSync(path.join(source, relative), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.endsWith(".map") || entry.name === "config.txt") continue;
      const resource = [relative, entry.name].filter(Boolean).join("/");
      if (/^(model|models|uv)(\/|$)/.test(resource)) continue;
      if (resource === "release.json" || resource.length > 240 || /[\\:\x00-\x1f<>"|?*%]/.test(resource)
        || resource.split("/").some(part => !part || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("Unsupported resource path");
      const full = path.join(source, resource), stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error("Symlinks are not publishable");
      if (stat.isDirectory()) { walk(resource); continue; }
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("Resource exceeds publication limit");
      files.push({ path: resource, size: stat.size, sha256: createHash("sha256").update(readFileSync(full)).digest("hex") });
    }
  }
  walk(); files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some(file => file.path === "index.html") || !files.some(file => file.path.endsWith(".js"))
    || new Set(files.map(file => file.path.toLowerCase())).size !== files.length
    || files.length > 2000 || files.reduce((sum, file) => sum + file.size, 0) > 256 * 1024 * 1024) throw new Error("Invalid or oversized frontend build");
  mkdirSync(root, { recursive: true });
  const signingKey = readFileSync(keyPath), lock = path.join(root, ".publish.lock");
  const descriptor = openSync(lock, "wx");
  const staging = path.join(root, `.publish-${randomUUID()}`), temporary = path.join(root, `.latest-${randomUUID()}.tmp`);
  try {
    const latest = readLatest(root, signingKey);
    if (latest && releaseId <= latest.manifest.releaseId) throw new Error("Release ID must be greater than the latest publication.");
    const manifest = { schemaVersion: 1, hostContract: 1, releaseId, buildId: build.buildId, minAppVersion: minimumVersion, files };
    const envelope = { manifest, signature: sign(null, Buffer.from(JSON.stringify(manifest)), signingKey).toString("base64") };
    mkdirSync(staging);
    let reusedBytes = 0;
    for (const file of files) {
      const to = path.join(staging, file.path); mkdirSync(path.dirname(to), { recursive: true });
      if (reusePublishedResource(root, latest, file, to)) reusedBytes += file.size;
      else cpSync(path.join(source, file.path), to);
      if (createHash("sha256").update(readFileSync(to)).digest("hex") !== file.sha256) throw new Error("Source changed during publication");
    }
    writeFileSync(path.join(staging, "release.json"), JSON.stringify(envelope));
    renameSync(staging, target);
    writeFileSync(temporary, JSON.stringify(envelope)); renameSync(temporary, path.join(root, "latest.json"));
    let removedReleases = 0;
    try { removedReleases = cleanupFrontendReleases(root, releaseId); } catch { /* Publication is already complete; cleanup is best effort. */ }
    return { releaseId, buildId: build.buildId, files: files.length, minAppVersion: minimumVersion, reusedBytes, removedReleases };
  } finally {
    for (const scratch of [staging, temporary]) {
      if (path.dirname(path.resolve(scratch)) === root) {
        try { rmSync(scratch, { recursive: true, force: true }); } catch { /* Locked scratch paths can be removed after this process exits. */ }
      }
    }
    try { closeSync(descriptor); } finally { rmSync(lock, { force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [buildDirectory, minimumVersion, requestedId] = process.argv.slice(2);
  console.log(JSON.stringify(publishFrontend(buildDirectory, minimumVersion,
    process.env.SHROOM_FRONTEND_RELEASE_DIR || "", process.env.SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH || "", requestedId)));
}
