import express from "express";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishFrontend } from "../scripts/publish-frontend-release";
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
  writeFileSync(path.join(build, "model/heavy.glb"), "synthetic heavy model");
  writeFileSync(path.join(build, "config.txt"), "private configuration");
  return { root, build, destination, keyPath, publicKey };
}

describe("signed frontend publishing and delivery", () => {
  it("publishes complete signed resources and excludes local configuration and heavy models", () => {
    const f = fixture();
    expect(publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "2").files).toBe(2);
    const release = JSON.parse(readFileSync(path.join(f.destination, "latest.json"), "utf8"));
    expect(verify(null, Buffer.from(JSON.stringify(release.manifest)), f.publicKey, Buffer.from(release.signature, "base64"))).toBe(true);
    expect(release.manifest.files.map((file: { path: string }) => file.path).sort()).toEqual(["assets/main.js", "index.html"]);
    expect(() => publishFrontend(f.build, "1.1.37", f.destination, f.keyPath, "2")).toThrow();
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
