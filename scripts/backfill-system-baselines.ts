import "dotenv/config";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { systemPackageEvents, systemPackageRollouts, systemPackageSubmissions, users } from "../drizzle/schema";
import { publicationBaseline } from "../server/systemPackages";

/** Freeze each legacy latest version without changing explicit customer/default pointers; dry-run is the default. */
async function main() {
  const apply = process.argv.includes("--apply");
  const actorId = Number(process.argv.find(value => value.startsWith("--admin-id="))?.split("=")[1]);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error("ADMIN_ID_REQUIRED");
  const db = await getDb(); if (!db) throw new Error("STORAGE_UNAVAILABLE");
  const [actor] = await db.select().from(users).where(eq(users.id, actorId)).limit(1);
  if (!actor || actor.role !== "super_admin" || !actor.isActive) throw new Error("ACTIVE_SUPER_ADMIN_REQUIRED");
  const systems = await db.selectDistinct({ systemId: systemPackageSubmissions.systemId }).from(systemPackageSubmissions).limit(1000);
  for (const { systemId } of systems) {
    const result = await db.transaction(async tx => {
      const revisions = await tx.select({ id: systemPackageSubmissions.id, status: systemPackageSubmissions.status })
        .from(systemPackageSubmissions).where(eq(systemPackageSubmissions.systemId, systemId))
        .orderBy(desc(systemPackageSubmissions.id)).for("update");
      const pointers = await tx.select().from(systemPackageRollouts).where(eq(systemPackageRollouts.systemId, systemId)).for("update");
      const latest = revisions.find(row => row.status === "published" || row.status === "revoked");
      if (!latest) return null;
      const version = publicationBaseline(revisions, pointers, latest.id);
      if (version === null) return null;
      if (apply) {
        await tx.insert(systemPackageRollouts).values({ systemId, customerId: 0, versionId: version, updatedById: actorId })
          .onDuplicateKeyUpdate({ set: { versionId: sql`version_id` } });
        await tx.insert(systemPackageEvents).values({ submissionId: version, actorId, action: "baseline-backfill",
          detailsJson: JSON.stringify({ systemId, version, policyVersion: 1 }) });
      }
      return { systemId, version, dryRun: !apply };
    });
    if (result) console.log(JSON.stringify(result));
  }
  if (systems.length === 1000) console.warn("SYSTEM_LIMIT_REACHED: repeat with a paginated operator plan before enabling candidate publication");
}
main().then(() => process.exit(0)).catch(() => { console.error("BASELINE_BACKFILL_FAILED"); process.exit(1); });
