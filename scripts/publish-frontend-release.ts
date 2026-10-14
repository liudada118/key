import { createHash, sign } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Publish a complete built webpage using the existing server signing key, without changing an installer. */
export function publishFrontend(buildDirectory: string, minimumVersion: string, destination: string, keyPath: string, requestedId?: string) {
  if (!buildDirectory || !/^\d+\.\d+\.\d+$/.test(minimumVersion || "") || !destination || !keyPath) throw new Error("Provide build directory, minimum app version, and both publication environment variables.");
  const releaseId = requestedId ? Number(requestedId) : Date.now();
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error("Invalid release ID");
  const source = path.resolve(buildDirectory), target = path.resolve(destination, String(releaseId));
  if (source === path.resolve(destination) || target.startsWith(source + path.sep) || existsSync(target)) throw new Error("Publication paths overlap or this release already exists.");
  const files: { path: string; size: number; sha256: string }[] = [];
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
  const manifest = { schemaVersion: 1, hostContract: 1, releaseId, minAppVersion: minimumVersion, files };
  const envelope = { manifest, signature: sign(null, Buffer.from(JSON.stringify(manifest)), readFileSync(keyPath)).toString("base64") };
  mkdirSync(target, { recursive: true });
  for (const file of files) {
    const to = path.join(target, file.path); mkdirSync(path.dirname(to), { recursive: true }); cpSync(path.join(source, file.path), to);
    if (createHash("sha256").update(readFileSync(to)).digest("hex") !== file.sha256) throw new Error("Source changed during publication");
  }
  writeFileSync(path.join(target, "release.json"), JSON.stringify(envelope));
  const temporary = path.join(destination, `.latest-${releaseId}.tmp`);
  writeFileSync(temporary, JSON.stringify(envelope)); renameSync(temporary, path.join(destination, "latest.json"));
  return { releaseId, files: files.length, minAppVersion: minimumVersion };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [buildDirectory, minimumVersion, requestedId] = process.argv.slice(2);
  console.log(JSON.stringify(publishFrontend(buildDirectory, minimumVersion,
    process.env.SHROOM_FRONTEND_RELEASE_DIR || "", process.env.SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH || "", requestedId)));
}
