import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("drizzle-orm/mysql2", async importOriginal => ({
  ...await importOriginal<typeof import("drizzle-orm/mysql2")>(),
  drizzle: () => fixture.db,
}));
import {
  createKeyGenerationRequest, getKeyGenerationRequestById,
  getKeyGenerationRequests, rejectKeyGenerationRequest,
} from "./db";
import { getKeyRequestNotifications, markKeyRequestResultsRead } from "./keyRequestNotifications";

const testUrl = process.env.KEY_REQUEST_TIME_TEST_URL;

describe.skipIf(!testUrl)("key request timestamps in real MySQL sessions", () => {
  let connection: Connection;

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Integration database must be local");
    }
    connection = await mysql.createConnection(url.toString());
    const { drizzle } = await vi.importActual<typeof import("drizzle-orm/mysql2")>("drizzle-orm/mysql2");
    fixture.db = drizzle(connection);
    vi.stubEnv("DATABASE_URL", testUrl!);
    // Temporary tables shadow the real names on this connection only.
    await connection.query(`CREATE TEMPORARY TABLE keyGenerationRequests (
      id int AUTO_INCREMENT PRIMARY KEY, productType varchar(32) DEFAULT 'shroom-desktop',
      requestNo varchar(64) NOT NULL UNIQUE, mode varchar(16), sensorTypes text,
      days int, category varchar(16) DEFAULT 'production', count int DEFAULT 1,
      reason text, generationRemark text, requestedById int, requestedByName varchar(128),
      status varchar(16) DEFAULT 'PENDING', reviewedById int, reviewedByName varchar(128),
      reviewRemark text, reviewedAt timestamp NULL, generatedAt timestamp NULL,
      generatedBatchId varchar(64), resultReadAt timestamp NULL, createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    await connection.query("CREATE TEMPORARY TABLE licenseKeys (generationRequestId int)");
  });

  afterAll(async () => {
    await connection?.end();
    vi.unstubAllEnvs();
  });

  it.each(["+08:00", "+00:00", "-07:00"])("preserves the real submission time with session timezone %s", async timezone => {
    await connection.query("SET SESSION time_zone = ?", [timezone]);
    await connection.query("DELETE FROM keyGenerationRequests");
    await connection.query(`INSERT INTO keyGenerationRequests
      (requestNo, createdAt, updatedAt, reviewedAt, generatedAt)
      VALUES ('historical-fixture', FROM_UNIXTIME(1793007790), FROM_UNIXTIME(1793007800),
        '2026-10-26 12:21:41', '2026-10-26 12:21:41')`);
    const { items } = await getKeyGenerationRequests({ page: 1, pageSize: 20 });
    expect(items).toHaveLength(1);
    expect(items[0].createdAt.toISOString()).toBe("2026-10-26T09:43:10.000Z");
    expect(items[0].updatedAt.toISOString()).toBe("2026-10-26T09:43:20.000Z");
    expect(items[0].reviewedAt?.toISOString()).toBe("2026-10-26T12:21:41.000Z");
    expect(items[0].generatedAt?.toISOString()).toBe("2026-10-26T12:21:41.000Z");
    const [{ createdAt }] = (await connection.query(
      "SELECT UNIX_TIMESTAMP(createdAt) AS createdAt FROM keyGenerationRequests",
    ))[0] as { createdAt: number }[];
    expect(Number(createdAt)).toBe(1793007790);

    const before = Date.now();
    const submitted = await createKeyGenerationRequest({
      requestNo: `new-fixture-${timezone}`, mode: "single", sensorTypes: '["hand"]',
      days: 30, reason: "Timezone fixture", requestedById: 7, requestedByName: "Fixture",
    });
    expect(submitted.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(submitted.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    const reread = await getKeyGenerationRequestById(submitted.id);
    expect(reread?.createdAt).toEqual(submitted.createdAt);
    const rejected = await rejectKeyGenerationRequest({
      requestId: submitted.id, reviewerId: 1, reviewerName: "Admin", reviewRemark: "Fixture",
    });
    expect(rejected?.createdAt).toEqual(submitted.createdAt);
    const afterReview = await getKeyGenerationRequestById(submitted.id);
    expect(afterReview?.createdAt).toEqual(submitted.createdAt);
    // TIMESTAMP(0) may round fractional seconds depending on MySQL SQL mode.
    expect(Math.abs(afterReview!.reviewedAt!.getTime() - rejected!.reviewedAt.getTime())).toBeLessThan(1000);
  });

  it("persists only the current applicant's explicitly viewed approved results", async () => {
    await connection.query("DELETE FROM keyGenerationRequests");
    await connection.query(`INSERT INTO keyGenerationRequests
      (id, requestNo, requestedById, status, resultReadAt) VALUES
      (1, 'own-approved-a', 7, 'APPROVED', NULL),
      (2, 'own-approved-b', 7, 'APPROVED', NULL),
      (3, 'other-approved', 8, 'APPROVED', NULL),
      (4, 'own-pending', 7, 'PENDING', NULL),
      (5, 'other-pending', 8, 'PENDING', NULL),
      (6, 'own-rejected', 7, 'REJECTED', NULL),
      (7, 'already-read', 7, 'APPROVED', '2026-10-26 12:00:00')`);
    expect(await getKeyRequestNotifications(7, false)).toEqual({ approved: 2, pending: 0 });
    expect(await getKeyRequestNotifications(7, true)).toEqual({ approved: 2, pending: 2 });
    await markKeyRequestResultsRead(7, [1, 3, 4, 6, 7]);
    expect(await getKeyRequestNotifications(7, false)).toEqual({ approved: 1, pending: 0 });
    const [rows] = await connection.query("SELECT id, CAST(resultReadAt AS CHAR) AS readAt FROM keyGenerationRequests ORDER BY id");
    const results = rows as { id: number; readAt: string | null }[];
    expect(results[0].readAt).not.toBeNull();
    expect(results.slice(1, 6).every(row => row.readAt === null)).toBe(true);
    expect(results[6].readAt).toBe("2026-10-26 12:00:00");
    await markKeyRequestResultsRead(7, [1]);
    const [unchanged] = await connection.query("SELECT CAST(resultReadAt AS CHAR) AS readAt FROM keyGenerationRequests WHERE id=1");
    expect((unchanged as { readAt: string }[])[0].readAt).toBe(results[0].readAt);
    await connection.query("UPDATE keyGenerationRequests SET status='APPROVED' WHERE id=4");
    expect(await getKeyRequestNotifications(7, true)).toEqual({ approved: 2, pending: 1 });
  });
});
