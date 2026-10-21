import express from "express";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentModelCatalog } from "./agentModelCatalog";

const disposers: (() => Promise<void> | void)[] = [];
const defaultPath = path.resolve(import.meta.dirname, "../config/agent-model-catalog.json");
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  vi.unstubAllEnvs();
});

/** Produce an independent public catalog without credentials or external model requests. */
function catalog() {
  return JSON.parse(readFileSync(defaultPath, "utf8"));
}

/** Serve the actual registration function using an isolated temporary configuration and HTTP port. */
async function fixture(useOverride = true) {
  const root = mkdtempSync(path.join(tmpdir(), "key-model-catalog-"));
  disposers.push(() => {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("key-model-catalog-")) {
      throw new Error("Unexpected model catalog fixture directory");
    }
    rmSync(root, { recursive: true, force: true });
  });
  const configPath = path.join(root, "catalog.json");
  writeFileSync(configPath, JSON.stringify(catalog()));
  vi.stubEnv("SHROOM_AGENT_MODEL_CATALOG_PATH", useOverride ? configPath : "");
  const app = express(); registerAgentModelCatalog(app);
  const server = app.listen(0, "127.0.0.1");
  disposers.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture HTTP address");
  return { configPath, url: `http://127.0.0.1:${address.port}/api/agent/model-catalog` };
}

describe("public Agent model catalog", () => {
  it("serves the shipped direct JSON catalog without a key and with refreshable CORS headers", async () => {
    const f = await fixture(false);
    const response = await fetch(f.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const received = await response.json();
    expect(received).toEqual(catalog());
    expect(received.providers.some((provider: { id: string; baseUrl: string }) => provider.id === "custom" && provider.baseUrl === "")).toBe(true);
  });

  it("prefers the absolute override and hot reloads atomic replacements without a server restart", async () => {
    const f = await fixture();
    const first = catalog(); first.version = "company-1"; first.providers[0].label = "公司模型服务";
    writeFileSync(f.configPath, JSON.stringify(first));
    expect(await (await fetch(f.url)).json()).toEqual(first);
    const next = catalog(); next.version = "company-2"; next.providers[0].models.push({ id: "future-model", label: "新版模型" });
    const pendingPath = `${f.configPath}.pending`; writeFileSync(pendingPath, JSON.stringify(next));
    renameSync(pendingPath, f.configPath);
    expect(await (await fetch(f.url)).json()).toEqual(next);
  });

  it("does not fall back to defaults or expose paths for missing, malformed, oversized or relative overrides", async () => {
    const f = await fixture();
    for (const content of ["{", "x".repeat(128 * 1024 + 1)]) {
      writeFileSync(f.configPath, content);
      const response = await fetch(f.url);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "AGENT_MODEL_CATALOG_UNAVAILABLE" });
    }
    const invalidEncoding = Buffer.from(JSON.stringify(catalog()).replace("DeepSeek", "!eepSeek"));
    invalidEncoding[invalidEncoding.indexOf("!eepSeek")] = 0xff;
    writeFileSync(f.configPath, invalidEncoding);
    expect((await fetch(f.url)).status).toBe(503);
    rmSync(f.configPath);
    expect((await fetch(f.url)).status).toBe(503);
    vi.stubEnv("SHROOM_AGENT_MODEL_CATALOG_PATH", "config/agent-model-catalog.json");
    expect((await fetch(f.url)).status).toBe(503);
  });

  it("rejects unknown fields at every level rather than publishing maintenance secrets", async () => {
    const f = await fixture();
    const examples = [
      { ...catalog(), apiKey: "synthetic-secret" },
      catalog(), catalog(),
    ];
    examples[1].providers[0].token = "synthetic-secret";
    examples[2].providers[0].models[0].credential = "synthetic-secret";
    for (const value of examples) {
      writeFileSync(f.configPath, JSON.stringify(value));
      const response = await fetch(f.url);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('{"error":"AGENT_MODEL_CATALOG_UNAVAILABLE"}');
    }
  });

  it("validates URL, identifier, membership, count and public string boundaries", async () => {
    const f = await fixture();
    const changes: ((value: ReturnType<typeof catalog>) => void)[] = [
      value => { value.schemaVersion = 2; },
      value => { value.version = "v".repeat(101); },
      value => { value.providers[0].id = "p".repeat(41); },
      value => { value.providers[0].id = "Bad-Provider"; },
      value => { value.providers[0].id = "0provider"; },
      value => { value.providers[0].id = "bad provider"; },
      value => { value.providers[0].label = "p".repeat(101); },
      value => { value.providers[0].hint = "p".repeat(501); },
      value => { value.providers[0].baseUrl = `https://models.example/${"x".repeat(1000)}`; },
      value => { value.providers[0].label = "bad\u0000label"; },
      value => { value.providers[0].label = "bad\u0085label"; },
      value => { value.providers[0].label = " "; },
      value => { value.providers[0].models[0].id = "m".repeat(121); },
      value => { value.providers[0].models[0].label = "m".repeat(101); },
      value => { value.providers[0].defaultModel = "unknown"; },
      value => { value.providers[0].models.push(value.providers[0].models[0]); },
      value => { value.providers.push(value.providers[0]); },
      value => { value.providers = value.providers.filter((provider: { id: string }) => provider.id !== "custom"); },
      value => { value.providers.find((provider: { id: string }) => provider.id === "custom").baseUrl = "https://private.example"; },
      value => { value.providers[0].models = []; },
      value => { value.providers[0].models = Array.from({ length: 101 }, (_, index) => ({ id: `model-${index}`, label: "model" })); },
      value => { value.providers = Array.from({ length: 33 }, (_, index) => ({ ...value.providers[0], id: `provider-${index}` })); },
    ];
    for (const invalidUrl of ["http://api.example/v1", "https://user:password@api.example/v1", "https://api.example/v1?key=private", "https://api.example/v1#private", "https://api.example/v1?", "https://api.example/v1#", "https://api.example/\nprivate", "not-an-address"]) {
      changes.push(value => { value.providers[0].baseUrl = invalidUrl; });
    }
    for (const change of changes) {
      const value = catalog(); change(value); writeFileSync(f.configPath, JSON.stringify(value));
      expect((await fetch(f.url)).status).toBe(503);
    }
  });

  it("accepts valid additions while keeping unsupported methods from changing public configuration", async () => {
    const f = await fixture(), value = catalog();
    value.providers.push({ id: "company_service-1", label: "公司 Responses 服务", baseUrl: "https://models.example/api/v1", defaultModel: "org/new-model:2", models: [{ id: "org/new-model:2", label: "新模型" }], hint: "" });
    writeFileSync(f.configPath, JSON.stringify(value));
    expect(await (await fetch(f.url)).json()).toEqual(value);
    const preflight = await fetch(f.url, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    const writeAttempt = await fetch(f.url, { method: "POST", body: "synthetic-secret" });
    expect(writeAttempt.status).toBe(405);
    expect(writeAttempt.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(await writeAttempt.json()).toEqual({ error: "METHOD_NOT_ALLOWED" });
    const head = await fetch(f.url, { method: "HEAD" });
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    expect(JSON.parse(readFileSync(f.configPath, "utf8"))).toEqual(value);
    value.providers[0].hint = "  可留空的说明  ";
    writeFileSync(f.configPath, JSON.stringify(value));
    expect((await (await fetch(f.url)).json()).providers[0].hint).toBe("可留空的说明");
  });
});
