import express from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerUsage, USAGE_PATH } from "./usage";
import { AgentSyncError } from "./agentSyncStore";
import { MAX_USAGE_BATCH_BYTES, sanitizeUsageEvent, usageBatchSchema, usageEventSchema } from "./usageSchema";

/** Build a valid usage envelope without real customer or license information. */
function sampleEvent() {
  return { schemaVersion: 1 as const, eventId: randomUUID(), installationId: randomUUID(), sessionId: randomUUID(),
    occurredAt: "2026-09-24T06:30:00.000Z", appVersion: "1.1.37", environment: "test" as const,
    eventName: "export_result" as const, properties: { featureId: "export", result: "success" as const, format: "csv" as const } };
}
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  })));
  vi.restoreAllMocks();
});

/** Serve only the analytics receiver on a temporary loopback port. */
async function harness(overrides: Partial<Parameters<typeof registerUsage>[1]> = {}) {
  const authenticate = vi.fn(async () => ({ sourceId: 12, customerId: 3, customerName: "Fixture" }));
  const persist = vi.fn(async () => {});
  const app = express();
  registerUsage(app, { authenticate, persist, ...overrides });
  app.use(express.json({ limit: "50mb" }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${USAGE_PATH}`;
  /** Send one synthetic batch with explicit transport overrides. */
  const send = (body: unknown = { schemaVersion: 1, events: [sampleEvent()] }, headers: Record<string, string> = {}) => fetch(url, {
    method: "POST", headers: { Authorization: `License ${"ab".repeat(64)}`, "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { send, url, authenticate, persist };
}

describe("usage receiver contract", () => {
  it("acknowledges exact IDs only after durable completion under server identity", async () => {
    let commit!: () => void;
    const persisted = new Promise<void>(resolve => { commit = resolve; });
    const persist = vi.fn(async () => persisted);
    const { send } = await harness({ persist });
    const events = [sampleEvent(), sampleEvent()];
    let responded = false;
    const response = send({ schemaVersion: 1, events }).then(value => { responded = true; return value; });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(responded).toBe(false);
    expect(persist).toHaveBeenCalledWith({ sourceId: 12, customerId: 3, customerName: "Fixture" }, usageBatchSchema.parse({ schemaVersion: 1, events }).events);
    commit();
    expect(await (await response).json()).toEqual({ accepted: true, eventIds: events.map(event => event.eventId) });
  });

  it("rejects unavailable license before parsing body and never accepts customer-provided identity", async () => {
    const denied = await harness({ authenticate: async () => { throw new AgentSyncError(403, "LICENSE_UNAVAILABLE"); } });
    expect((await denied.send("{bad")).status).toBe(403);
    expect(denied.persist).not.toHaveBeenCalled();
    const { send, authenticate, persist } = await harness();
    expect((await send(undefined, { Authorization: "Bearer invalid" })).status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
    expect((await send({ schemaVersion: 1, customerId: 7, events: [sampleEvent()] })).status).toBe(400);
    expect((await send({ schemaVersion: 1, events: [{ ...sampleEvent(), tenantId: 7 }] })).status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });

  it("bounds batch and event sizes, counts, event names, and properties", async () => {
    const { send, persist } = await harness();
    expect((await send(" ".repeat(MAX_USAGE_BATCH_BYTES + 1))).status).toBe(413);
    expect((await send({ schemaVersion: 1, events: Array.from({ length: 51 }, sampleEvent) })).status).toBe(400);
    expect((await send({ schemaVersion: 1, events: [{ ...sampleEvent(), eventName: "anything" }] })).status).toBe(400);
    expect((await send({ schemaVersion: 1, events: [{ ...sampleEvent(), properties: { filename: "secret.csv" } }] })).status).toBe(400);
    expect((await send({ schemaVersion: 1, events: [{ ...sampleEvent(), properties: { message: "non-error" } }] })).status).toBe(400);
    expect((await send({ schemaVersion: 1, events: [{ ...sampleEvent(), eventName: "error_reported", properties: { stack: "错".repeat(1800) } }] })).status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
    expect((await send({ schemaVersion: 1, events: Array.from({ length: 50 }, sampleEvent) })).status).toBe(200);
  });

  it("returns retryable failure or conflict without an acknowledgement or raw exception", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = await harness({ persist: async () => { throw new Error("password=secret raw SQL"); } });
    const response = await failure.send();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ accepted: false, error: "STORAGE_UNAVAILABLE" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    const conflict = await harness({ persist: async () => { throw new AgentSyncError(409, "EVENT_CONTENT_CONFLICT"); } });
    expect((await conflict.send()).status).toBe(409);
  });

  it("rejects unsupported content types, malformed JSON and incorrect methods", async () => {
    const { send, url } = await harness();
    expect((await send({}, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send("{bad")).status).toBe(400);
    const response = await fetch(url);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("enforces per-source rate limiting", async () => {
    const { send } = await harness();
    for (let index = 0; index < 60; index++) expect((await send()).status).toBe(200);
    const response = await send();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("scrubs credentials, email addresses, URLs and local paths from error payloads", () => {
    const event = usageEventSchema.parse({ ...sampleEvent(), eventName: "error_reported", properties: {
      message: "token=hidden API_KEY=private License abcdef123456 test@example.com https://host/path?key=hidden {\"apiKey\":\"quoted-secret\"}",
      stack: "Error at C:\\Users\\person\\secret.js\n at /home/person/secret.js\n Bearer secretvalue",
    } });
    const safe = JSON.stringify(sanitizeUsageEvent(event));
    for (const privateText of ["hidden", "private", "abcdef123456", "test@example.com", "host/path", "person", "secretvalue", "quoted-secret"]) expect(safe).not.toContain(privateText);
  });

  it("redacts complete quoted credential values including spaces and escaped quotes", () => {
    const event = usageEventSchema.parse({ ...sampleEvent(), eventName: "error_reported", properties: {
      message: '{"password":"private phrase \\"quoted\\" tail","apiKey":"key value"} token=bare_value',
      stack: "secret='single quoted phrase' authorization=\"Basic abc def\" licenseKey:'license value' harmless context",
    } });
    const safe = JSON.stringify(sanitizeUsageEvent(event));
    for (const privateText of ["private", "phrase", "quoted", "tail", "key value", "bare_value", "single", "Basic", "abc", "def", "license value"]) expect(safe).not.toContain(privateText);
    expect(safe).toContain("harmless context");
  });
});
