import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeReleaseManifest } from "../scripts/deploy-maintenance.mjs";

const commit = "a".repeat(40), project = path.resolve(import.meta.dirname, "..");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const roots: string[] = [];
const shellPath = (value: string) => process.platform === "win32"
  ? value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`) : value;

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("key-deploy-shell-")) throw new Error("Unexpected fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "key-deploy-shell-")); roots.push(root);
  const app = path.join(root, "app"), input = path.join(root, "deployments/123-1"), bin = path.join(root, "bin"), build = path.join(root, "build");
  for (const folder of [app, input, bin, path.join(build, "dist")]) mkdirSync(folder, { recursive: true });
  const write = (file: string, content: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content); };
  write(path.join(app, "dist/index.js"), "OLD_BUILD"); write(path.join(app, ".env"), "SYNTHETIC=keep");
  write(path.join(app, "node_modules/keep.txt"), "untouched");
  for (const name of ["index.js", "migrate.js", "package.json", "public/index.html", "config/licenseSensorGroups.json", "drizzle/meta/_journal.json"]) write(path.join(build, "dist", name), "NEW_BUILD");
  writeReleaseManifest(path.join(build, "dist"), commit);
  const archive = path.join(input, "key-manager-build.tgz");
  execFileSync("tar", ["-czf", archive, "-C", build, "dist"]);
  write(`${archive}.sha256`, `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  key-manager-build.tgz\n`);
  write(path.join(input, "scripts/deploy-maintenance.mjs"), readFileSync(path.join(project, "scripts/deploy-maintenance.mjs"), "utf8"));
  const stub = (name: string, source: string) => writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\nset -eu\n${source}\n`, { mode: 0o755 });
  stub("node", `echo "node \${1##*/} \${2:-}" >> "$COMMAND_LOG"
if [[ "$1" == */migrate.js ]]; then [ "\${FAIL_MIGRATION:-0}" != 1 ]; exit; fi
exec "$REAL_NODE" "$@"`);
  stub("flock", 'echo "flock $*" >> "$COMMAND_LOG"');
  stub("nice", 'echo "nice $1 $2" >> "$COMMAND_LOG"; shift 2; exec "$@"');
  stub("ionice", 'echo "ionice $1 $2 $3 $4" >> "$COMMAND_LOG"; shift 4; exec "$@"');
  stub("pm2", `echo "pm2 $*" >> "$COMMAND_LOG"
if [ "\${FAIL_RESTART:-0}" = 1 ] && [ "$1" = restart ] && grep -q NEW_BUILD "$APP_ROOT/dist/index.js"; then exit 1; fi`);
  stub("sleep", ":");
  stub("curl", `if [ "\${FAIL_HEALTH:-0}" = 1 ]; then exit 7; fi
output=""; health=0
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output=$2; shift;; */healthz) health=1;; esac
  shift
done
if [ "$health" = 1 ]; then printf '{"ok":true,"commit":"%s"}' "$EXPECTED_COMMIT" > "$output"; else cp "$APP_ROOT/dist/public/index.html" "$output"; fi`);
  for (const name of ["git", "pnpm", "npm"]) stub(name, `echo "FORBIDDEN ${name}" >> "$COMMAND_LOG"; exit 99`);
  const log = path.join(root, "commands.log");
  return { app, input, run: (extra: NodeJS.ProcessEnv = {}, sha = commit) => {
    const result = spawnSync(bash, ["-c", 'export PATH="$FIXTURE_BIN:$PATH"; exec bash "$@"', "deploy-test", shellPath(path.join(project, "scripts/deploy-server.sh")), shellPath(app), shellPath(input), sha], {
      encoding: "utf8", windowsHide: true, timeout: 20000,
      env: { ...process.env, FIXTURE_BIN: shellPath(bin), REAL_NODE: shellPath(process.execPath),
        APP_ROOT: shellPath(app), COMMAND_LOG: shellPath(log), EXPECTED_COMMIT: commit, ...extra },
    });
    return { ...result, log: existsSync(log) ? readFileSync(log, "utf8") : "", state: existsSync(path.join(input, ".key-manager-deployment.json"))
      ? JSON.parse(readFileSync(path.join(input, ".key-manager-deployment.json"), "utf8")).state : null };
  } };
}

describe.skipIf(!existsSync(bash))("low-I/O deployment shell with isolated command stubs", () => {
  it("switches only dist, retains rollback and configuration, and never installs or fetches", () => {
    const f = fixture(), result = f.run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.state).toBe("success");
    expect(readFileSync(path.join(f.app, "dist/index.js"), "utf8")).toBe("NEW_BUILD");
    expect(readFileSync(path.join(f.input, "previous-dist/index.js"), "utf8")).toBe("OLD_BUILD");
    expect(readFileSync(path.join(f.app, ".env"), "utf8")).toBe("SYNTHETIC=keep");
    expect(readFileSync(path.join(f.app, "node_modules/keep.txt"), "utf8")).toBe("untouched");
    expect(result.log).not.toContain("FORBIDDEN");
    expect(result.log).toContain("ionice -c 2 -n 7");
    expect(result.log.match(/deploy-maintenance.mjs cleanup/g)).toHaveLength(1);
    expect(existsSync(path.join(f.input, "key-manager-build.tgz"))).toBe(false);
  });
  it("leaves the running files in place when migration fails", () => {
    const f = fixture(), result = f.run({ FAIL_MIGRATION: "1" });
    expect(result.status).not.toBe(0); expect(result.state).toBe("failed");
    expect(readFileSync(path.join(f.app, "dist/index.js"), "utf8")).toBe("OLD_BUILD");
    expect(result.log).not.toContain("pm2 restart");
  });
  it("applies first-boot configuration inside the deployment lock", () => {
    const f = fixture(); rmSync(path.join(f.app, ".env"));
    writeFileSync(path.join(f.input, "bootstrap.env"), "SYNTHETIC=bootstrap", { mode: 0o600 });
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(f.app, ".env"), "utf8")).toBe("SYNTHETIC=bootstrap");
    expect(existsSync(path.join(f.input, "bootstrap.env"))).toBe(false);
  });
  it.each(["FAIL_HEALTH", "FAIL_RESTART"])("restores the entire previous dist after %s", flag => {
    const f = fixture(), result = f.run({ [flag]: "1" });
    expect(result.status).not.toBe(0); expect(result.state).toBe("failed");
    expect(readFileSync(path.join(f.app, "dist/index.js"), "utf8")).toBe("OLD_BUILD");
    expect(readFileSync(path.join(f.input, "failed-dist/index.js"), "utf8")).toBe("NEW_BUILD");
    expect(result.log.match(/pm2 restart/g)).toHaveLength(2);
  });
  it("rejects an artifact from another commit before migration or restart", () => {
    const f = fixture(), result = f.run({}, "b".repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.log).not.toContain("migrate.js");
    expect(result.log).not.toContain("pm2 restart");
  });
});
