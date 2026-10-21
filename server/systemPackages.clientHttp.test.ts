import express from "express";
import { createServer, type Server } from "node:http";
import { createSign, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateLicenseKey } from "../shared/crypto";

const fixture = vi.hoisted(() => ({ batches: [] as unknown[][] }));

/** Return queued rows through the same awaitable builder shape used by the package routes. */
function selection() {
  const builder: any = {
    from: () => builder, innerJoin: () => builder, where: () => builder,
    orderBy: () => builder, limit: () => builder,
    then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(fixture.batches.shift() ?? []).then(resolve, reject),
  };
  return builder;
}

vi.mock("./db", () => ({ getDb: async () => ({ select: selection,
  transaction: async (operation: (tx: { select: typeof selection }) => Promise<unknown>) => operation({ select: selection }),
}) }));
import { registerSystemPackages } from "./systemPackages";

describe("company package client HTTP authorization without customer selection", () => {
  let server: Server, base: string, directory: string;
  const packageSigning = generateKeyPairSync("ed25519");
  const onlineKey = generateLicenseKey(["seatpad"], 1);
  const onlineRow = { keyString: onlineKey, customerId: null, isDeleted: false,
    status: "ISSUED", expireTimestamp: Date.now() + 3600000 };
  const release = { id: 3, systemId: "seatpad", name: "坐垫", status: "published",
    audienceJson: "[42]", sha256: "a".repeat(64), signature: "fixture-signature" };

  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "company-package-http-"));
    const keyPath = path.join(directory, "package-signing.pem");
    writeFileSync(keyPath, packageSigning.privateKey.export({ type: "pkcs8", format: "pem" }));
    vi.stubEnv("SHROOM_SYSTEM_PACKAGE_SIGNING_KEY_PATH", keyPath);
    const app = express(); registerSystemPackages(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local test server address");
    base = `http://127.0.0.1:${address.port}/api/system-packages/client`;
  });

  beforeEach(() => { fixture.batches = []; });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  /** Send one authorized client request with isolated fake database result batches. */
  async function request(route: string, batches: unknown[][], key = onlineKey) {
    fixture.batches = batches;
    const response = await fetch(`${base}${route}`, { headers: { Authorization: `License ${key}` } });
    return { response, body: await response.json() };
  }

  /** Query signed status only for the installed identities declared by this synthetic client. */
  async function installed(systems: unknown[], batches: unknown[][], key = onlineKey) {
    fixture.batches = batches;
    const response = await fetch(`${base}/installed-status`, { method: "POST",
      headers: { Authorization: `License ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ systems }) });
    return { response, body: await response.json() };
  }

  it("returns a signed catalog and downloads a customer-only release for an unlinked authorized online key", async () => {
    const catalog = await request("/catalog", [[onlineRow], [release], []]);
    expect(catalog.response.status).toBe(200);
    expect(catalog.body.catalog.systems).toMatchObject([{ systemId: "seatpad", version: 3 }]);
    expect(verify(null, Buffer.from(JSON.stringify(catalog.body.catalog)), packageSigning.publicKey,
      Buffer.from(catalog.body.signature, "base64"))).toBe(true);
    const downloaded = await request("/packages/seatpad/3", [[onlineRow], [release], [],
      [{ ...release, packageJson: JSON.stringify({ systemId: "seatpad" }) }]]);
    expect(downloaded.response.status).toBe(200);
    expect(downloaded.body).toEqual({ package: { systemId: "seatpad" }, version: 3, signature: "fixture-signature" });
  });

  it("returns a signed key-bound diagnostic policy without extending the catalog schema", async () => {
    const result = await request("/policy", [[onlineRow]]);
    expect(result.response.status).toBe(200);
    expect(result.body.policy).toMatchObject({ schemaVersion: 1, diagnosticOnly: true,
      publicationMode: "candidate-then-promote", retention: { chatDays: 180, usageDays: 90 } });
    expect(verify(null, Buffer.from(JSON.stringify(result.body.policy)), packageSigning.publicKey,
      Buffer.from(result.body.signature, "base64"))).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain(onlineKey);
  });

  it("signs exact installed-version status and caps validity at the license expiry", async () => {
    const result = await installed([{ id: "seatpad", version: 3 }], [[onlineRow], [release]]);
    expect(result.response.status).toBe(200);
    expect(result.body.grant).toMatchObject({ schemaVersion: 1, type: "installed-system-status",
      systems: [{ id: "seatpad", version: 3, status: "published", sha256: release.sha256, withdrawal: null }] });
    expect(result.body.grant.expiresAt).toBeLessThanOrEqual(onlineRow.expireTimestamp);
    expect(verify(null, Buffer.from(JSON.stringify(result.body.grant)), packageSigning.publicKey,
      Buffer.from(result.body.signature, "base64"))).toBe(true);
  });

  it("reports version-specific withdrawal and discloses no unauthorized release metadata", async () => {
    const event = { detailsJson: JSON.stringify({ withdrawal: { schemaVersion: 1, mode: "stop-new-acquisition",
      effectiveAt: 100, reason: "test" } }), createdAt: new Date(100) };
    const result = await installed([{ id: "seatpad", version: 3 }, { id: "private-system", version: 55 }],
      [[onlineRow], [{ ...release, status: "revoked" }], [event]]);
    expect(result.body.grant.systems[0].withdrawal.mode).toBe("stop-new-acquisition");
    expect(result.body.grant.systems[1]).toEqual({ id: "private-system", version: 55, status: "unauthorized", sha256: null, withdrawal: null });
    const legacy = await installed([{ id: "seatpad", version: 3 }], [[onlineRow], [{ ...release, status: "revoked" }], []]);
    expect(legacy.body.grant.systems[0].withdrawal.mode).toBe("stop-distribution");
  });

  it("rejects duplicate, oversized, malformed installed requests and expired keys", async () => {
    const one = { id: "seatpad", version: 3 };
    for (const systems of [[one, one], Array.from({ length: 33 }, (_, version) => ({ id: "seatpad", version: version + 1 })),
      [{ id: 123, version: 3 }], [{ id: "../escape", version: 3 }], [{ ...one, extra: true }]]) {
      expect((await installed(systems, [[onlineRow]])).response.status).toBe(400);
    }
    expect((await installed([one], [[{ ...onlineRow, expireTimestamp: Date.now() - 1 }]])).response.status).toBe(403);
  });

  it("accepts an RSA-signed unlinked offline key for both catalog and direct package download", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const expireDate = Date.now() + 3600000;
    const payload = Buffer.from(JSON.stringify({ sensorTypes: ["seatpad"], expireDate, version: 2 })).toString("base64");
    const signer = createSign("RSA-SHA256"); signer.update(payload); signer.end();
    const key = Buffer.from(JSON.stringify({ payload, signature: signer.sign(rsa.privateKey, "base64") })).toString("base64");
    const row = { activationCode: key, customerId: null, isDeleted: false, status: "ISSUED", expireDate,
      publicKey: rsa.publicKey.export({ type: "spki", format: "pem" }).toString() };
    const catalog = await request("/catalog", [[row], [release], []], key);
    expect(catalog.response.status).toBe(200);
    expect(catalog.body.catalog.systems).toHaveLength(1);
    const downloaded = await request("/packages/seatpad/3", [[row], [release], [],
      [{ ...release, packageJson: JSON.stringify({ systemId: "seatpad" }) }]], key);
    expect(downloaded.response.status).toBe(200);
    expect(downloaded.body.version).toBe(3);
  });

  it("hides unauthorized systems and rejects direct package access despite an all-customer audience", async () => {
    const other = { ...release, systemId: "unlicensed", audienceJson: '"all"' };
    const catalog = await request("/catalog", [[onlineRow], [other], []]);
    expect(catalog.body.catalog.systems).toEqual([]);
    const downloaded = await request("/packages/unlicensed/3", [[onlineRow], [other], []]);
    expect(downloaded.response.status).toBe(404);
    expect(downloaded.body.error).toBe("NOT_AVAILABLE");
  });

  it("honors a global rollback and keeps a withdrawn global pointer unavailable", async () => {
    const older = { ...release, id: 1 };
    const rollback = [{ systemId: "seatpad", customerId: 0, versionId: 1 }];
    const catalog = await request("/catalog", [[onlineRow], [release, older], rollback]);
    expect(catalog.body.catalog.systems[0].version).toBe(1);
    const newer = await request("/packages/seatpad/3", [[onlineRow], [release, older], rollback]);
    expect(newer.response.status).toBe(404);
    const withdrawn = [{ systemId: "seatpad", customerId: 0, versionId: 99 }];
    const hidden = await request("/catalog", [[onlineRow], [release, older], withdrawn]);
    expect(hidden.body.catalog.systems).toEqual([]);
    const direct = await request("/packages/seatpad/3", [[onlineRow], [release, older], withdrawn]);
    expect(direct.response.status).toBe(404);
  });

  it("rejects an unlinked key after revocation or expiry", async () => {
    const revoked = await request("/catalog", [[{ ...onlineRow, status: "REVOKED" }]]);
    expect(revoked.response.status).toBe(403);
    expect(revoked.body.error).toBe("LICENSE_INACTIVE");
    const expired = await request("/packages/seatpad/3", [[{ ...onlineRow, expireTimestamp: Date.now() - 1 }]]);
    expect(expired.response.status).toBe(403);
    expect(expired.body.error).toBe("LICENSE_EXPIRED");
  });
});
