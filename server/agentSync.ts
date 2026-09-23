import express, { type ErrorRequestHandler, type Express } from "express";
import { agentSyncEventSchema, MAX_AGENT_EVENT_BYTES } from "./agentSyncSchema";
import { AgentSyncError, authenticateLicenseUpload, authenticateUpload, persistAgentEvent } from "./agentSyncStore";

export const AGENT_SYNC_PATH = "/api/agent/conversations";

export function registerAgentSync(app: Express, dependencies = {
  authenticate: authenticateUpload, authenticateLicense: authenticateLicenseUpload, persist: persistAgentEvent,
}) {
  const route = express.Router();
  const buckets = new Map<number, { start: number; count: number }>();
  route.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    // A timed-out write may still commit; the client's retry is protected by the durable receipt.
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(503).json({ accepted: false, error: "RECEIVE_TIMEOUT" });
    }, 12000);
    timer.unref();
    res.once("close", () => clearTimeout(timer));
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ accepted: false, error: "METHOD_NOT_ALLOWED" });
      return;
    }
    next();
  });
  route.use(async (req, res, next) => {
    const match = /^Bearer (ags_[A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? "");
    const license = /^License ([a-fA-F0-9]{32,8192})$/.exec(req.headers.authorization ?? "");
    if (!match && !license) { next(new AgentSyncError(401, "INVALID_CREDENTIAL")); return; }
    try {
      const principal = license ? await dependencies.authenticateLicense(license[1]) : await dependencies.authenticate(match![1]);
      if (res.writableEnded || res.destroyed) return;
      const now = Date.now();
      buckets.forEach((bucket, key) => { if (now - bucket.start >= 60000) buckets.delete(key); });
      const bucket = buckets.get(principal.tenantId) ?? { start: now, count: 0 };
      if (bucket.count >= 60 || (!buckets.has(principal.tenantId) && buckets.size >= 10000)) {
        res.setHeader("Retry-After", "60");
        throw new AgentSyncError(429, "RATE_LIMITED");
      }
      bucket.count++;
      buckets.set(principal.tenantId, bucket);
      res.locals.agentPrincipal = principal;
      if (!req.is("application/json")) throw new AgentSyncError(415, "JSON_REQUIRED");
      next();
    } catch (error) { next(error); }
  });
  // Mounted before the application's 50 MB parser: authentication precedes any body processing.
  route.use(express.json({ limit: MAX_AGENT_EVENT_BYTES, inflate: false }));
  route.post("/", async (req, res, next) => {
    if (res.writableEnded || res.destroyed) return;
    const result = agentSyncEventSchema.safeParse(req.body);
    if (!result.success || req.headers["idempotency-key"] !== result.data.eventId) {
      next(new AgentSyncError(400, "INVALID_EVENT")); return;
    }
    try {
      await dependencies.persist(res.locals.agentPrincipal.tenantId, result.data);
      if (!res.writableEnded && !res.destroyed) res.status(200).json({ accepted: true, eventId: result.data.eventId });
    } catch (error) { next(error); }
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    let status = 503;
    let code = "STORAGE_UNAVAILABLE";
    if (error instanceof AgentSyncError) { status = error.status; code = error.code; }
    else if (error?.type === "entity.too.large") { status = 413; code = "EVENT_TOO_LARGE"; }
    else if (error?.type === "encoding.unsupported" || error?.type === "charset.unsupported") { status = 415; code = "ENCODING_UNSUPPORTED"; }
    else if (error?.type === "entity.parse.failed" || error?.type === "request.aborted" || error?.type === "request.size.invalid") { status = 400; code = "INVALID_JSON"; }
    // Never log request headers, chat content, SQL parameters or raw database exceptions.
    if (status === 409 || status >= 500) console.error("[AgentSync]", code, { tenantId: res.locals.agentPrincipal?.tenantId });
    if (!res.headersSent && !res.destroyed) res.status(status).json({ accepted: false, error: code });
  };
  route.use(handleError);
  app.use(AGENT_SYNC_PATH, route);
}
