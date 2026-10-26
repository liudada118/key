import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyGenerationRequests } from "../drizzle/schema";

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fixture.db }));
import {
  approveKeyGenerationRequestWithKeys,
  createKeyGenerationRequest,
  getKeyGenerationRequestById,
  getKeyGenerationRequests,
  rejectKeyGenerationRequest,
} from "./db";

const queries: string[] = [];
const createdEpoch = 1793007790; // 2026-10-26 17:43:10 in Asia/Shanghai.
const input = {
  requestNo: "KGR-20261026-TIMEZONE",
  mode: "single" as const,
  sensorTypes: '["hand"]',
  days: 30,
  reason: "Timezone regression fixture",
  requestedById: 7,
  requestedByName: "Fixture",
};

beforeEach(() => {
  queries.length = 0;
  vi.stubEnv("DATABASE_URL", "mysql://unused:unused@localhost/unused");
  const db = drizzle(async (query) => {
    queries.push(query);
    if (query.startsWith("select count(")) return { rows: [[1]] };
    if (query.includes("from `keyGenerationRequests`")) {
      const row: Record<string, unknown> = {
        ...input, id: 17, productType: "shroom-desktop", category: "production",
        count: 1, status: "PENDING", createdAt: String(createdEpoch),
        updatedAt: String(createdEpoch + 10), reviewedAt: "2026-10-26 12:21:41",
        generatedAt: "2026-10-26 12:21:41",
      };
      return { rows: [Object.keys(getTableColumns(keyGenerationRequests)).map(name => row[name] ?? null)] };
    }
    if (query.startsWith("select")) return { rows: [] };
    return { rows: [{ insertId: 17, affectedRows: 1 }] };
  });
  // Exercise the same selection inside approval/rejection transactions.
  Object.assign(db, { transaction: async (callback: (tx: typeof db) => unknown) => callback(db) });
  fixture.db = db;
});

afterEach(() => vi.unstubAllEnvs());

function expectCorrectTime(row: { createdAt: Date; updatedAt: Date }) {
  expect(row.createdAt.getTime()).toBe(createdEpoch * 1000);
  expect(row.updatedAt.getTime()).toBe((createdEpoch + 10) * 1000);
  expect(row.createdAt.toISOString()).toBe("2026-10-26T09:43:10.000Z");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(row.createdAt);
  expect(Object.fromEntries(parts.map(part => [part.type, part.value]))).toMatchObject({
    year: "2026", month: "10", day: "26", hour: "17", minute: "43", second: "10",
  });
  const selections = queries.filter(query => query.includes("from `keyGenerationRequests`"));
  expect(selections.length).toBeGreaterThan(0);
  for (const query of selections.filter(query => !query.startsWith("select count("))) {
    expect(query).toContain("UNIX_TIMESTAMP(`createdAt`)");
    expect(query).toContain("UNIX_TIMESTAMP(`updatedAt`)");
    expect(query).not.toContain("UNIX_TIMESTAMP(`reviewedAt`)");
    expect(query).not.toContain("UNIX_TIMESTAMP(`generatedAt`)");
  }
}

describe("key request database-generated timestamps", () => {
  it.each(["UTC", "Asia/Shanghai", "America/Los_Angeles"])("lists the actual instant under runtime timezone %s", async timezone => {
    vi.stubEnv("TZ", timezone);
    const result = await getKeyGenerationRequests({ page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expectCorrectTime(result.items[0]);
    expect(result.items[0].reviewedAt?.toISOString()).toBe("2026-10-26T12:21:41.000Z");
    expect(result.items[0].generatedAt?.toISOString()).toBe("2026-10-26T12:21:41.000Z");
  });

  it("uses the corrected timestamps immediately after submission", async () => {
    expectCorrectTime(await createKeyGenerationRequest(input));
  });

  it("uses the corrected timestamps when reading an individual request", async () => {
    expectCorrectTime((await getKeyGenerationRequestById(17))!);
  });

  it("retains the submission instant when an administrator approves", async () => {
    const result = await approveKeyGenerationRequestWithKeys({
      requestId: 17, reviewerId: 1, reviewerName: "Admin",
      records: [{ keyString: "synthetic-key", sensorType: "hand", days: 30,
        expireTimestamp: 1796000000000, createdById: 7 }],
    });
    expectCorrectTime(result!);
    expect(result?.status).toBe("APPROVED");
  });

  it("retains the submission instant when an administrator rejects", async () => {
    const result = await rejectKeyGenerationRequest({
      requestId: 17, reviewerId: 1, reviewerName: "Admin", reviewRemark: "Fixture",
    });
    expectCorrectTime(result!);
    expect(result?.status).toBe("REJECTED");
  });
});
