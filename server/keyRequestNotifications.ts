import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { keyGenerationRequests } from "../drizzle/schema";
import { getDb } from "./db";

export async function getKeyRequestNotifications(userId: number, isSuperAdmin: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [approved] = await db.select({ count: count() }).from(keyGenerationRequests).where(and(
    eq(keyGenerationRequests.requestedById, userId),
    eq(keyGenerationRequests.status, "APPROVED"),
    isNull(keyGenerationRequests.resultReadAt),
  ));
  const [pending] = isSuperAdmin
    ? await db.select({ count: count() }).from(keyGenerationRequests)
        .where(eq(keyGenerationRequests.status, "PENDING"))
    : [];
  return { approved: approved?.count ?? 0, pending: pending?.count ?? 0 };
}

export async function markKeyRequestResultsRead(userId: number, ids: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (ids.length === 0) return;
  // A stale page or a guessed ID cannot acknowledge someone else's result or a
  // request that was still pending when the applicant opened the page.
  await db.update(keyGenerationRequests).set({ resultReadAt: new Date() }).where(and(
    inArray(keyGenerationRequests.id, Array.from(new Set(ids))),
    eq(keyGenerationRequests.requestedById, userId),
    eq(keyGenerationRequests.status, "APPROVED"),
    isNull(keyGenerationRequests.resultReadAt),
  ));
}
