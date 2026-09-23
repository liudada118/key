import express from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentSync, AGENT_SYNC_PATH } from "./agentSync";
import { agentSyncEventSchema, MAX_AGENT_EVENT_BYTES } from "./agentSyncSchema";
import { AgentSyncError } from "./agentSyncStore";

const token = `ags_${"a".repeat(43)}`;
export function sampleEvent(revision = 1) {
  return { schemaVersion: 1, eventType: "agent.conversation.upsert", eventId: randomUUID(),
    installationId: randomUUID(), conversationId: "conversation-test", revision,
    occurredAt: "2026-09-22T06:30:00.000Z", appVersion: "1.1.37",
    conversation: { id: "conversation-test", messages: [
      { id: "message-1", role: "user", text: "Test message", attachmentIds: ["attachment-1"] },
      { id: "message-2", role: "assistant", text: "Done" },
    ], tasks: [{ id: "task-1", status: "succeeded" }], attachments: [{ id: "attachment-1", name: "data.csv", kind: "csv", size: 1024 }] },
  };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  })));
  vi.restoreAllMocks();
});

async function harness(overrides: Partial<Parameters<typeof registerAgentSync>[1]> = {}) {
  const authenticate = vi.fn(async () => ({ tenantId: 42, credentialId: 1 }));
  const authenticateLicense = vi.fn(async () => ({ tenantId: 43, credentialId: 0 }));
  const persist = vi.fn(async () => {});
  const app = express();
  registerAgentSync(app, { authenticate, authenticateLicense, persist, ...overrides });
  app.use(express.json({ limit: "50mb" }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const send = (event = sampleEvent(), options: { body?: string; token?: string; eventId?: string; scheme?: string } = {}) => fetch(`http://127.0.0.1:${port}${AGENT_SYNC_PATH}`, {
    method: "POST", headers: { Authorization: `${options.scheme ?? 'Bearer'} ${options.token ?? token}`, "Content-Type": "application/json", "Idempotency-Key": options.eventId ?? event.eventId },
    body: options.body ?? JSON.stringify(event),
  });
  return { send, authenticate, authenticateLicense, persist };
}

describe("Agent conversation receiver", () => {
  it("accepts License authentication separately from upload credentials", async () => {
    const { send, authenticate, authenticateLicense, persist } = await harness();
    const key = 'ab'.repeat(64), event = sampleEvent();
    expect((await send(event, { scheme: 'License', token: key })).status).toBe(200);
    expect(authenticateLicense).toHaveBeenCalledWith(key);
    expect(authenticate).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith(43, agentSyncEventSchema.parse(event));
    expect((await send(event, { scheme: 'License', token: 'bad-key' })).status).toBe(401);
  });

  it("rejects unavailable licenses before JSON parsing", async () => {
    const { send, persist } = await harness({ authenticateLicense: async () => { throw new AgentSyncError(403, 'LICENSE_UNAVAILABLE'); } });
    expect((await send(sampleEvent(), { scheme: 'License', token: 'ab'.repeat(64), body: '{bad' })).status).toBe(403);
    expect(persist).not.toHaveBeenCalled();
  });
  it("persists using authenticated tenant and confirms the exact event", async () => {
    const { send, persist } = await harness();
    const event = sampleEvent();
    const response = await send(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, eventId: event.eventId });
    expect(persist).toHaveBeenCalledWith(42, agentSyncEventSchema.parse(event));
  });

  it("authenticates before parsing invalid JSON or oversized bodies", async () => {
    const { send, persist } = await harness({ authenticate: async () => { throw new AgentSyncError(401, "INVALID_CREDENTIAL"); } });
    expect((await send(sampleEvent(), { body: "{invalid" })).status).toBe(401);
    expect((await send(sampleEvent(), { body: "x".repeat(MAX_AGENT_EVENT_BYTES + 1) })).status).toBe(401);
    expect(persist).not.toHaveBeenCalled();
  });

  it("enforces the 8 MiB boundary with matching acknowledgements", async () => {
    const { send } = await harness();
    const event = sampleEvent();
    event.conversation.messages[0].text = "";
    event.conversation.messages[0].text = "x".repeat(MAX_AGENT_EVENT_BYTES - Buffer.byteLength(JSON.stringify(event)));
    expect((await send(event)).status).toBe(200);
    event.conversation.messages[0].text += "x";
    expect((await send(event)).status).toBe(413);
  });

  it("rejects header mismatch, malformed JSON, extra data and invalid IDs", async () => {
    const { send, persist } = await harness();
    const event = sampleEvent();
    expect((await send(event, { eventId: randomUUID() })).status).toBe(400);
    expect((await send(event, { body: "{" })).status).toBe(400);
    expect((await send(event, { body: JSON.stringify({ ...event, tenantId: 99 }) })).status).toBe(400);
    event.conversation.id = "different";
    expect((await send(event)).status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });

  it("returns safe 503 on storage failure and never acknowledges failed persistence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { send } = await harness({ persist: async () => { throw new Error("SQL with private chat text"); } });
    const response = await send();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ accepted: false, error: "STORAGE_UNAVAILABLE" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private chat");
  });

  it("returns 409 for event content conflicts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { send } = await harness({ persist: async () => { throw new AgentSyncError(409, "EVENT_CONTENT_CONFLICT"); } });
    expect((await send()).status).toBe(409);
  });

  it("throttles a tenant after 60 requests per minute", async () => {
    const { send, persist } = await harness();
    const event = sampleEvent();
    for (let index = 0; index < 60; index++) expect((await send(event)).status).toBe(200);
    const response = await send(event);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(persist).toHaveBeenCalledTimes(60);
  });
});

describe("Agent event allowlist", () => {
  it("accepts failed task metadata but rejects tool data, duplicate IDs and unreferenced attachments", () => {
    const event = sampleEvent();
    expect(agentSyncEventSchema.safeParse({ ...event, conversation: { ...event.conversation,
      tasks: [{ id: "failed-task", status: "failed", errorCode: "MODEL_ERROR" }],
    } }).success).toBe(true);
    expect(agentSyncEventSchema.safeParse({ ...event, conversation: { ...event.conversation, tools: [] } }).success).toBe(false);
    event.conversation.messages.push(event.conversation.messages[0]);
    expect(agentSyncEventSchema.safeParse(event).success).toBe(false);
    event.conversation.messages.pop();
    event.conversation.attachments[0].id = "not-referenced";
    expect(agentSyncEventSchema.safeParse(event).success).toBe(false);
  });
});
