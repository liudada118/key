import express, { type ErrorRequestHandler, type Express } from "express";
import { AgentSyncError } from "./agentSyncStore";
import { authenticateUsage, persistUsageBatch } from "./usageStore";
import { MAX_USAGE_BATCH_BYTES, usageBatchSchema } from "./usageSchema";

export const USAGE_PATH = "/api/usage/events/batch";

/** Receive bounded, authenticated batches and acknowledge only committed event IDs. */
export function registerUsage(app: Express, dependencies = { authenticate: authenticateUsage, persist: persistUsageBatch }) {
  const route = express.Router();
  const buckets = new Map<number, { start: number; count: number }>();
  route.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ accepted: false, error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(503).json({ accepted: false, error: "RECEIVE_TIMEOUT" });
    }, 12000);
    timer.unref();
    res.once("close", () => clearTimeout(timer));
    next();
  });
  route.use(async (req, res, next) => {
    try {
      const match = /^License ([a-fA-F0-9]{32,8192})$/.exec(req.headers.authorization ?? "");
      if (!match) throw new AgentSyncError(401, "INVALID_CREDENTIAL");
      const principal = await dependencies.authenticate(match[1]);
      if (res.writableEnded || res.destroyed) return;
      const now = Date.now();
      buckets.forEach((bucket, key) => { if (now - bucket.start >= 60000) buckets.delete(key); });
      const bucket = buckets.get(principal.sourceId) ?? { start: now, count: 0 };
      if (bucket.count >= 60 || (!buckets.has(principal.sourceId) && buckets.size >= 10000)) {
        res.setHeader("Retry-After", "60");
        throw new AgentSyncError(429, "RATE_LIMITED");
      }
      bucket.count++;
      buckets.set(principal.sourceId, bucket);
      res.locals.usagePrincipal = principal;
      if (!req.is("application/json")) throw new AgentSyncError(415, "JSON_REQUIRED");
      next();
    } catch (error) { next(error); }
  });
  route.use(express.json({ limit: MAX_USAGE_BATCH_BYTES, inflate: false }));
  route.post("/", async (req, res, next) => {
    if (res.writableEnded || res.destroyed) return;
    const parsed = usageBatchSchema.safeParse(req.body);
    if (!parsed.success) { next(new AgentSyncError(400, "INVALID_EVENT")); return; }
    try {
      await dependencies.persist(res.locals.usagePrincipal, parsed.data.events);
      if (!res.writableEnded && !res.destroyed) res.json({ accepted: true, eventIds: parsed.data.events.map(event => event.eventId) });
    } catch (error) { next(error); }
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    let status = 503, code = "STORAGE_UNAVAILABLE";
    if (error instanceof AgentSyncError) { status = error.status; code = error.code; }
    else if (error?.type === "entity.too.large") { status = 413; code = "BATCH_TOO_LARGE"; }
    else if (error?.type === "encoding.unsupported" || error?.type === "charset.unsupported") { status = 415; code = "ENCODING_UNSUPPORTED"; }
    else if (["entity.parse.failed", "request.aborted", "request.size.invalid"].includes(error?.type)) { status = 400; code = "INVALID_JSON"; }
    // Raw exceptions can contain SQL parameters, credentials or customer content.
    if (status >= 500) console.error("[Usage]", code);
    if (!res.headersSent && !res.destroyed) res.status(status).json({ accepted: false, error: code });
  };
  route.use(handleError);
  app.use(USAGE_PATH, route);
}
