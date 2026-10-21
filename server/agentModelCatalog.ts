import { type Express } from "express";
import { existsSync, closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const MAX_CATALOG_BYTES = 128 * 1024;
const CATALOG_RELATIVE_PATH = path.join("config", "agent-model-catalog.json");
const forbiddenControl = /[\u0000-\u001f\u007f-\u009f]/;

/** Validate bounded public text without accepting hidden control characters or blank labels. */
function catalogText(maximum: number) {
  return z.string().min(1).max(maximum).refine(value => value.trim() === value && !forbiddenControl.test(value));
}

const modelSchema = z.object({ id: catalogText(120), label: catalogText(100) }).strict();
const providerSchema = z.object({
  id: catalogText(40).refine(value => /^[a-z][a-z0-9_-]*$/.test(value)),
  label: catalogText(100),
  baseUrl: z.string().max(1000),
  defaultModel: catalogText(120),
  models: z.array(modelSchema).min(1).max(100),
  hint: z.string().max(500).refine(value => !forbiddenControl.test(value)).transform(value => value.trim()).optional(),
}).strict().superRefine((provider, context) => {
  const ids = provider.models.map(model => model.id);
  if (new Set(ids).size !== ids.length || !ids.includes(provider.defaultModel)) {
    context.addIssue({ code: "custom", message: "Invalid model identifiers" });
  }
  if (provider.id === "custom") {
    if (provider.baseUrl !== "") context.addIssue({ code: "custom", message: "Custom provider must use an empty address" });
    return;
  }
  try {
    const address = new URL(provider.baseUrl);
    if (provider.baseUrl.trim() !== provider.baseUrl || forbiddenControl.test(provider.baseUrl) || /[?#]/.test(provider.baseUrl)
      || address.protocol !== "https:" || address.username || address.password || address.search || address.hash) {
      throw new Error("Invalid provider address");
    }
  } catch {
    context.addIssue({ code: "custom", message: "Invalid provider address" });
  }
});

const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  version: catalogText(100),
  providers: z.array(providerSchema).min(1).max(32),
}).strict().superRefine((catalog, context) => {
  const ids = catalog.providers.map(provider => provider.id);
  if (new Set(ids).size !== ids.length || !ids.includes("custom")) {
    context.addIssue({ code: "custom", message: "Invalid provider identifiers" });
  }
});

/** Resolve an explicit absolute override before deployment and source defaults. */
function resolveCatalogPath() {
  const configured = process.env.SHROOM_AGENT_MODEL_CATALOG_PATH?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("Agent catalog path must be absolute");
    return configured;
  }
  const packaged = path.resolve(import.meta.dirname, CATALOG_RELATIVE_PATH);
  return existsSync(packaged) ? packaged : path.resolve(process.cwd(), CATALOG_RELATIVE_PATH);
}

/** Read at most 128 KiB per request; reject unknown fields so credentials cannot become public. */
function readCatalog() {
  const descriptor = openSync(resolveCatalogPath(), "r");
  try {
    const bytes = Buffer.alloc(MAX_CATALOG_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_CATALOG_BYTES) throw new Error("Agent catalog is too large");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    return catalogSchema.parse(JSON.parse(content));
  } finally {
    closeSync(descriptor);
  }
}

/** Publish only validated model metadata; atomic file replacement updates the next GET without restart. */
export function registerAgentModelCatalog(app: Express) {
  const route = "/api/agent/model-catalog";
  app.use(route, (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");
    next();
  });
  app.get(route, (_req, res) => {
    try {
      res.json(readCatalog());
    } catch {
      res.status(503).json({ error: "AGENT_MODEL_CATALOG_UNAVAILABLE" });
    }
  });
  app.options(route, (_req, res) => {
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.sendStatus(204);
  });
  app.all(route, (_req, res) => {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  });
}
