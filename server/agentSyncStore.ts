import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { agentConversations, agentSyncEvents, agentUploadCredentials, customers } from "../drizzle/schema";
import { getDb } from "./db";
import type { AgentSyncEvent } from "./agentSyncSchema";

export class AgentSyncError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export const hashUploadToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function database() {
  const db = await getDb();
  if (!db) throw new AgentSyncError(503, "STORAGE_UNAVAILABLE");
  return db;
}

export async function issueUploadCredential(input: { tenantId: number; name: string; days: number; createdById: number }) {
  const db = await database();
  const [customer] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, input.tenantId), eq(customers.isActive, true))).limit(1);
  if (!customer) throw new AgentSyncError(400, "CUSTOMER_UNAVAILABLE");
  const token = `ags_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + input.days * 86400000);
  const [{ id }] = await db.insert(agentUploadCredentials).values({
    tenantId: input.tenantId, name: input.name, createdById: input.createdById,
    tokenHash: hashUploadToken(token), tokenPrefix: token.slice(0, 12), expiresAt,
  }).$returningId();
  return { id, token, tenantId: input.tenantId, expiresAt };
}

export async function listUploadCredentials(tenantId: number) {
  const db = await database();
  return db.select({
    id: agentUploadCredentials.id, name: agentUploadCredentials.name,
    tokenPrefix: agentUploadCredentials.tokenPrefix, tenantId: agentUploadCredentials.tenantId,
    scope: agentUploadCredentials.scope, expiresAt: agentUploadCredentials.expiresAt,
    revokedAt: agentUploadCredentials.revokedAt, createdAt: agentUploadCredentials.createdAt,
  }).from(agentUploadCredentials).where(eq(agentUploadCredentials.tenantId, tenantId))
    .orderBy(desc(agentUploadCredentials.id)).limit(1000);
}

export async function revokeUploadCredential(id: number) {
  const db = await database();
  await db.update(agentUploadCredentials).set({ revokedAt: new Date() }).where(eq(agentUploadCredentials.id, id));
}

export async function listAgentChatCustomers() {
  const db = await database();
  return db.select({ customerId: agentConversations.tenantId, name: customers.name, conversationCount: count() })
    .from(agentConversations).leftJoin(customers, eq(customers.id, agentConversations.tenantId))
    .groupBy(agentConversations.tenantId, customers.name).orderBy(asc(agentConversations.tenantId));
}

// Read database-generated timestamps as epoch seconds, independent of the MySQL session timezone.
const receivedAt = sql`UNIX_TIMESTAMP(${agentConversations.receivedAt})`.mapWith(value => new Date(Number(value) * 1000));

export async function listAgentConversations(input: { customerId?: number; page: number; pageSize: number }) {
  const db = await database();
  const where = input.customerId === undefined ? undefined : eq(agentConversations.tenantId, input.customerId);
  const [{ total }] = await db.select({ total: count() }).from(agentConversations).where(where);
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  // Return bounded previews, not the full (up to 8 MiB) snapshots, for the list.
  const items = await db.select({
    customerId: agentConversations.tenantId, customerName: customers.name,
    installationId: agentConversations.installationId, conversationId: agentConversations.conversationId,
    revision: agentConversations.revision, receivedAt,
    preview: sql<string>`LEFT(JSON_UNQUOTE(JSON_EXTRACT(${agentConversations.snapshotJson}, '$.conversation.messages[0].text')), 160)`,
    messageCount: sql<number>`JSON_LENGTH(JSON_EXTRACT(${agentConversations.snapshotJson}, '$.conversation.messages'))`,
  }).from(agentConversations).leftJoin(customers, eq(customers.id, agentConversations.tenantId))
    .where(where).orderBy(desc(agentConversations.receivedAt), asc(agentConversations.tenantId),
      asc(agentConversations.installationId), asc(agentConversations.conversationId))
    .limit(input.pageSize).offset((page - 1) * input.pageSize);
  return { items, total, page };
}

export async function getAgentConversation(input: {
  customerId: number; installationId: string; conversationId: string; messagePage: number; taskPage: number;
}) {
  const db = await database();
  const [row] = await db.select({ snapshotJson: agentConversations.snapshotJson, receivedAt,
    customerName: customers.name, revision: agentConversations.revision,
  }).from(agentConversations).leftJoin(customers, eq(customers.id, agentConversations.tenantId))
    .where(and(eq(agentConversations.tenantId, input.customerId),
      eq(agentConversations.installationId, input.installationId.toLowerCase()),
      eq(agentConversations.conversationId, input.conversationId))).limit(1);
  if (!row) return null;
  const event = JSON.parse(row.snapshotJson) as AgentSyncEvent;
  const pageSize = 50;
  const messagePage = Math.min(input.messagePage, Math.max(1, Math.ceil(event.conversation.messages.length / pageSize)));
  const taskPage = Math.min(input.taskPage, Math.max(1, Math.ceil(event.conversation.tasks.length / pageSize)));
  const messages = event.conversation.messages.slice((messagePage - 1) * pageSize, messagePage * pageSize);
  const referenced = new Set(messages.flatMap(message => message.attachmentIds ?? []));
  return {
    customerId: input.customerId, customerName: row.customerName,
    installationId: event.installationId, conversationId: event.conversationId,
    revision: row.revision, receivedAt: row.receivedAt, occurredAt: event.occurredAt,
    createdAt: event.conversation.createdAt, appVersion: event.appVersion,
    messages, messageCount: event.conversation.messages.length, messagePage,
    tasks: event.conversation.tasks.slice((taskPage - 1) * pageSize, taskPage * pageSize),
    taskCount: event.conversation.tasks.length, taskPage, pageSize,
    attachments: event.conversation.attachments.filter(attachment => referenced.has(attachment.id)),
  };
}

export async function authenticateUpload(token: string) {
  const db = await database();
  const [row] = await db.select({ credential: agentUploadCredentials, active: customers.isActive })
    .from(agentUploadCredentials).innerJoin(customers, eq(customers.id, agentUploadCredentials.tenantId))
    .where(eq(agentUploadCredentials.tokenHash, hashUploadToken(token))).limit(1);
  if (!row || row.credential.revokedAt || row.credential.expiresAt.getTime() <= Date.now()) {
    throw new AgentSyncError(401, "INVALID_CREDENTIAL");
  }
  if (!row.active || row.credential.scope !== "agent:upload") throw new AgentSyncError(403, "UPLOAD_FORBIDDEN");
  return { tenantId: row.credential.tenantId, credentialId: row.credential.id };
}

export async function persistAgentEvent(tenantId: number, event: AgentSyncEvent, connection?: Awaited<ReturnType<typeof database>>) {
  const db = connection ?? await database();
  const installationId = event.installationId.toLowerCase();
  const eventId = event.eventId.toLowerCase();
  // Zod reconstructs every object in schema order, so whitespace/key order do not alter the digest.
  const snapshotJson = JSON.stringify(event);
  const payloadHash = hashUploadToken(snapshotJson);
  await db.transaction(async tx => {
    // Unique-key insertion locks the receipt even on first upload, including concurrent retries.
    await tx.insert(agentSyncEvents).values({
      tenantId, installationId, eventId, conversationId: event.conversationId,
      revision: event.revision, payloadHash,
    }).onDuplicateKeyUpdate({ set: { eventId: sql`event_id` } });
    const [receipt] = await tx.select().from(agentSyncEvents).where(and(
      eq(agentSyncEvents.tenantId, tenantId), eq(agentSyncEvents.installationId, installationId),
      eq(agentSyncEvents.eventId, eventId),
    )).for("update");
    if (receipt.payloadHash !== payloadHash) throw new AgentSyncError(409, "EVENT_CONTENT_CONFLICT");

    // Revision is assigned LAST: both conditional assignments compare against the previous revision.
    await tx.insert(agentConversations).values({
      tenantId, installationId, conversationId: event.conversationId,
      revision: event.revision, snapshotJson,
    }).onDuplicateKeyUpdate({ set: {
      snapshotJson: sql`IF(${event.revision} > revision, ${snapshotJson}, snapshot_json)`,
      receivedAt: sql`IF(${event.revision} > revision, CURRENT_TIMESTAMP, received_at)`,
      revision: sql`GREATEST(revision, ${event.revision})`,
    } });
  });
}
