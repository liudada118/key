import express from "express";
import { generateKeyPairSync, verify } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupFrontendReleases, publishFrontend } from "../scripts/publish-frontend-release";
import { registerFrontendUpdates } from "./frontendUpdates";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.unstubAllEnvs(); });

/** Publish synthetic code with ephemeral keys, never touch the production signing key or release directory. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "key-frontend-test-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const build = path.join(root, "build"), destination = path.join(root, "published"), keyPath = path.join(root, "test.pem");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  mkdirSync(path.join(build, "assets"), { recursive: true }); mkdirSync(path.join(build, "model"));
  writeFileSync(path.join(build, "index.html"), '<script type="module" src="/assets/main.js"></script>');
  writeFileSync(path.join(build, "assets/main.js"), "window.synthetic=true;");
  writeFileSync(path.join(build, "frontend-build.json"), JSON.stringify({ schemaVersion: 1, buildId: 100, appVersion: "1.1.37" }));
  writeFileSync(path.join(build, "model/heavy.glb"), "synthetic heavy model");
  writeFileSync(path.join(build, "config.txt"), "private configuration");
  return { root, build, destination, keyPath, publicKey };
}

describe("signed frontend publishing and delivery", () => {
  it("publishes complete signed resources and excludes local configuration and heavy models", () => {
    const f = fixture();
    expect(publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "2").files).toBe(3);
    const release = JSON.parse(readFileSync(path.join(f.destination, "latest.json"), "utf8"));
    expect(verify(null, Buffer.from(JSON.stringify(release.manifest)), f.publicKey, Buffer.from(release.signature, "base64"))).toBe(true);
    expect(release.manifest.buildId).toBe(100);
    expect(release.manifest.files.map((file: { path: string }) => file.path).sort()).toEqual(["assets/main.js", "frontend-build.json", "index.html"]);
    expect(() => publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "2")).toThrow();
  });

  it("reuses immutable bytes across renamed resources, keeps mutable uploads separate and rejects backward IDs", () => {
    const f = fixture(); publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "2");
    writeFileSync(path.join(f.build, "index.html"), '<div>new release</div><script src="/assets/main.js"></script>');
    writeFileSync(path.join(f.build, "assets/renamed.js"), "window.synthetic=true;");
    const result = publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "3");
    expect(result.reusedBytes).toBeGreaterThanOrEqual(2 * Buffer.byteLength("window.synthetic=true;"));
    expect(statSync(path.join(f.destination, "2/assets/main.js")).ino).toBe(statSync(path.join(f.destination, "3/assets/renamed.js")).ino);
    writeFileSync(path.join(f.build, "assets/main.js"), "changed mutable upload");
    expect(readFileSync(path.join(f.destination, "3/assets/main.js"), "utf8")).toBe("window.synthetic=true;");
    expect(() => publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "1")).toThrow(/greater than/);
    expect(existsSync(path.join(f.destination, ".publish.lock"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(f.destination, "latest.json"), "utf8")).manifest.releaseId).toBe(3);
  });

  it("requires actual build metadata and refetches from the input when reusable server files are damaged", () => {
    const f = fixture(); publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "2");
    writeFileSync(path.join(f.destination, "2/assets/main.js"), "bad cached server file");
    publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "3");
    expect(readFileSync(path.join(f.destination, "3/assets/main.js"), "utf8")).toBe("window.synthetic=true;");
    rmSync(path.join(f.build, "frontend-build.json"));
    expect(() => publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "4")).toThrow();
    expect(existsSync(path.join(f.destination, "4"))).toBe(false);
  });

  it("keeps latest, five recent releases and a download grace period while leaving unrelated files intact", () => {
    const f = fixture();
    for (let id = 1; id <= 8; id++) publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, String(id));
    mkdirSync(path.join(f.destination, "unrelated-business-data"));
    const old = new Date(Date.now() - 2 * 86400000);
    for (let id = 1; id <= 8; id++) utimesSync(path.join(f.destination, String(id)), old, old);
    utimesSync(path.join(f.destination, "2"), new Date(), new Date());
    expect(cleanupFrontendReleases(f.destination, 1)).toBe(1);
    expect(existsSync(path.join(f.destination, "1"))).toBe(true);
    expect(existsSync(path.join(f.destination, "2"))).toBe(true);
    expect(existsSync(path.join(f.destination, "3"))).toBe(false);
    for (let id = 4; id <= 8; id++) expect(existsSync(path.join(f.destination, String(id)))).toBe(true);
    expect(existsSync(path.join(f.destination, "unrelated-business-data"))).toBe(true);
  });

  it("serves JavaScript with its correct MIME type, rejects missing files and refuses a tampered latest manifest", async () => {
    const f = fixture(); publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "3");
    vi.stubEnv("SHROOM_FRONTEND_RELEASE_DIR", f.destination); vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", f.keyPath);
    const app = express(); registerFrontendUpdates(app);
    const server = app.listen(0, "127.0.0.1");
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing test address");
    const url = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${url}/api/frontend/latest`)).status).toBe(200);
    const js = await fetch(`${url}/api/frontend/releases/3/assets/main.js`);
    expect(js.headers.get("content-type")).toMatch(/javascript/); expect(await js.text()).toBe("window.synthetic=true;");
    expect((await fetch(`${url}/api/frontend/releases/3/config.txt`)).status).toBe(404);
    expect((await fetch(`${url}/api/frontend/releases/3/assets/missing.js`)).status).toBe(404);
    const release = JSON.parse(readFileSync(path.join(f.destination, "latest.json"), "utf8"));
    release.manifest.minAppVersion = "0.0.0"; writeFileSync(path.join(f.destination, "latest.json"), JSON.stringify(release));
    expect((await fetch(`${url}/api/frontend/latest`)).status).toBe(503);
  });
});
