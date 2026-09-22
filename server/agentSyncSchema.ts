import { z } from "zod";

export const MAX_AGENT_EVENT_BYTES = 8 * 1024 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const time = z.string().datetime({ offset: true });
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const agentSyncEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventType: z.literal("agent.conversation.upsert"),
  eventId: z.string().uuid(),
  installationId: z.string().uuid(),
  conversationId: id,
  revision: safeInteger.min(1),
  occurredAt: time,
  appVersion: z.string().max(80).optional(),
  conversation: z.object({
    id,
    createdAt: time.optional(),
    messages: z.array(z.object({
      id,
      taskId: id.optional(),
      role: z.enum(["user", "assistant"]),
      text: z.string().max(MAX_AGENT_EVENT_BYTES),
      createdAt: time.optional(),
      attachmentIds: z.array(id).max(10000).optional(),
    }).strict()).max(50000),
    tasks: z.array(z.object({
      id,
      status: z.string().regex(/^[a-z_]{1,40}$/),
      createdAt: time.optional(),
      finishedAt: time.optional(),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),
    }).strict()).max(50000),
    attachments: z.array(z.object({
      id,
      name: z.string().max(255),
      kind: z.enum(["image", "text", "csv", "json", "xlsx", "file"]).optional(),
      size: safeInteger.optional(),
    }).strict()).max(10000),
  }).strict(),
}).strict().superRefine((event, ctx) => {
  if (event.conversationId !== event.conversation.id) {
    ctx.addIssue({ code: "custom", message: "Conversation ID mismatch" });
  }
  for (const records of [event.conversation.messages, event.conversation.tasks, event.conversation.attachments]) {
    if (new Set(records.map(record => record.id)).size !== records.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate record IDs" });
    }
  }
  const referenced = new Set(event.conversation.messages.flatMap(message => message.attachmentIds ?? []));
  if (event.conversation.attachments.some(attachment => !referenced.has(attachment.id))) {
    ctx.addIssue({ code: "custom", message: "Unreferenced attachment" });
  }
});

export type AgentSyncEvent = z.infer<typeof agentSyncEventSchema>;
