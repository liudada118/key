import express from "express";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { registerUsage } from "../server/usage";
import { AgentSyncError } from "../server/agentSyncStore";
import { sanitizeUsageEvent, type UsageEvent } from "../server/usageSchema";

const syntheticLicense = "ab".repeat(64);
let events = new Map<string, { hash: string; event: UsageEvent }>();
const app = express();
registerUsage(app, {
  /** Authenticate only the documented synthetic fixture license, without consulting any database. */
  async authenticate(key) {
    if (key !== syntheticLicense) throw new AgentSyncError(401, "INVALID_LICENSE");
    return { sourceId: 1, customerId: 1, customerName: "Synthetic desktop fixture" };
  },
  /** Commit a whole synthetic batch atomically while preserving production schema and redaction. */
  async persist(principal, incoming) {
    const next = new Map(events);
    for (const raw of incoming) {
      const event = sanitizeUsageEvent(raw);
      const hash = createHash("sha256").update(JSON.stringify({ ...raw, eventId: event.eventId,
        installationId: event.installationId, sessionId: event.sessionId, occurredAt: event.occurredAt })).digest("hex");
      const identity = `${principal.sourceId}:${event.installationId}:${event.eventId}`;
      if (next.has(identity) && next.get(identity)!.hash !== hash) throw new AgentSyncError(409, "EVENT_CONTENT_CONFLICT");
      next.set(identity, { hash, event });
    }
    events = next;
  },
});
app.get("/fixture/events", (_req, res) => res.json({ events: [...events.values()].map(item => item.event) }));
const server = createServer(app);
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ port: (server.address() as { port: number }).port })}\n`);
});
/** Close only this loopback fixture and release its input handle. */
function close() { server.closeAllConnections(); server.close(() => process.exit(0)); }
process.stdin.resume();
process.stdin.on("data", data => { if (data.toString().trim() === "close") close(); });
process.stdin.on("end", close);
process.on("SIGINT", close);
process.on("SIGTERM", close);
