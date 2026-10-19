import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupDeployments, dependencyFingerprint, recordDeployment, verifyRelease, writeReleaseManifest } from "../scripts/deploy-maintenance.mjs";

const temporary: string[] = [];
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "key-deploy-maintenance-")); temporary.push(root);
  const add = (id: string, state: string, updatedAt: number) => {
    const directory = path.join(root, id); mkdirSync(directory);
    recordDeployment(root, directory, state, updatedAt); return directory;
  };
  return { root, add };
}

describe("deployment retention and dependency reuse", () => {
  it("keeps two successful deployments and one failure while preserving the current attempt", () => {
    const f = fixture();
    const directories = [f.add("10-1", "success", 10), f.add("20-1", "success", 20), f.add("30-1", "success", 30),
      f.add("40-1", "failed", 40), f.add("50-1", "failed", 50), f.add("60-1", "prepared", 60)];
    expect(cleanupDeployments(f.root, directories[5], 100).removed).toBe(2);
    expect(directories.map(existsSync)).toEqual([false, true, true, false, true, true]);
  });

  it("deletes successful upload scratch files but preserves the rollback build", () => {
    const f = fixture(), current = f.add("10-1", "success", 10);
    for (const name of ["key-manager-build.tgz", "key-manager-build.tgz.sha256", "health-index.html", "bootstrap.env"]) writeFileSync(path.join(current, name), "fixture");
    mkdirSync(path.join(current, "staging")); mkdirSync(path.join(current, "previous-dist"));
    cleanupDeployments(f.root, current);
    expect(existsSync(path.join(current, "key-manager-build.tgz"))).toBe(false);
    expect(existsSync(path.join(current, "bootstrap.env"))).toBe(false);
    expect(existsSync(path.join(current, "staging"))).toBe(false);
    expect(existsSync(path.join(current, "previous-dist"))).toBe(true);
  });

  it("preserves unrelated, unmarked and linked directories and bounds abandoned attempts", () => {
    const f = fixture(), current = f.add("10-1", "success", 10);
    const old = f.add("20-1", "prepared", 0), recent = f.add("30-1", "prepared", 86400001);
    const unmarked = path.join(f.root, "40-1"), business = path.join(f.root, "business");
    mkdirSync(unmarked); mkdirSync(business);
    const outside = fixture(); writeFileSync(path.join(outside.root, "keep.txt"), "keep");
    symlinkSync(outside.root, path.join(f.root, "50-1"), process.platform === "win32" ? "junction" : "dir");
    cleanupDeployments(f.root, current, 86400002);
    expect(existsSync(old)).toBe(false);
    for (const directory of [recent, unmarked, business, outside.root]) expect(existsSync(directory)).toBe(true);
    expect(readFileSync(path.join(outside.root, "keep.txt"), "utf8")).toBe("keep");
    expect(() => cleanupDeployments(f.root, outside.root)).toThrow(/Deployment path/);
  });

  it("retains failed scratch and rollback evidence without retaining partial environment files", () => {
    const f = fixture(), current = f.add("10-1", "failed", 10);
    writeFileSync(path.join(current, "key-manager-build.tgz"), "fixture");
    writeFileSync(path.join(current, "bootstrap.env"), "SYNTHETIC=value");
    mkdirSync(path.join(current, "previous-dist"));
    cleanupDeployments(f.root, current);
    expect(existsSync(path.join(current, "key-manager-build.tgz"))).toBe(true);
    expect(existsSync(path.join(current, "previous-dist"))).toBe(true);
    expect(existsSync(path.join(current, "bootstrap.env"))).toBe(false);
  });

  it("invalidates dependency reuse on patch, manifest or Node changes but not application code", () => {
    const f = fixture();
    writeFileSync(path.join(f.root, "package.json"), "{}");
    writeFileSync(path.join(f.root, "pnpm-lock.yaml"), "lockfileVersion: 9");
    mkdirSync(path.join(f.root, "patches"));
    const initial = dependencyFingerprint(f.root, "22.22.0");
    writeFileSync(path.join(f.root, "app.ts"), "export {};");
    expect(dependencyFingerprint(f.root, "22.22.0")).toBe(initial);
    expect(dependencyFingerprint(f.root, "22.23.0")).not.toBe(initial);
    writeFileSync(path.join(f.root, "patches", "fix.patch"), "changed");
    const patched = dependencyFingerprint(f.root, "22.22.0"); expect(patched).not.toBe(initial);
    writeFileSync(path.join(f.root, "package.json"), '{"version":"2.0.0"}');
    expect(dependencyFingerprint(f.root, "22.22.0")).not.toBe(patched);
  });
  it("verifies all release bytes and rejects a different commit, missing or extra files", () => {
    const f = fixture(), commit = "a".repeat(40);
    for (const name of ["index.js", "migrate.js", "package.json", "public/index.html", "config/licenseSensorGroups.json", "drizzle/meta/_journal.json"]) {
      const target = path.join(f.root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, "fixture");
    }
    expect(writeReleaseManifest(f.root, commit)).toMatchObject({ files: 6 });
    expect(verifyRelease(f.root, commit)).toMatchObject({ files: 6 });
    expect(() => verifyRelease(f.root, "b".repeat(40))).toThrow(/identity/);
    writeFileSync(path.join(f.root, "extra.txt"), "unexpected");
    expect(() => verifyRelease(f.root, commit)).toThrow(/checksum/);
    rmSync(path.join(f.root, "extra.txt"));
    writeFileSync(path.join(f.root, "index.js"), "tampered");
    expect(() => verifyRelease(f.root, commit)).toThrow(/checksum/);
  });
  it("refuses a dependency directory, hidden credentials or symlinks in the release", () => {
    for (const name of ["node_modules", ".env"]) {
      const f = fixture(); writeFileSync(path.join(f.root, name), "fixture");
      expect(() => writeReleaseManifest(f.root, "a".repeat(40))).toThrow(/Unexpected/);
    }
    const f = fixture(), outside = fixture();
    symlinkSync(outside.root, path.join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(() => writeReleaseManifest(f.root, "a".repeat(40))).toThrow(/symlinks/);
  });
});
