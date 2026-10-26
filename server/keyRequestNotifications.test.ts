import { drizzle } from "drizzle-orm/mysql-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("./db", () => ({ getDb: async () => fixture.db }));
import { getKeyRequestNotifications, markKeyRequestResultsRead } from "./keyRequestNotifications";

const queries: { sql: string; params: unknown[] }[] = [];
beforeEach(() => {
  queries.length = 0;
  fixture.db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: sql.startsWith("select") ? [[2]] : [{ affectedRows: 1 }] };
  });
});

describe("key request notification storage", () => {
  it.each([false, true])("counts only the applicant's unread approved results (super admin %s)", async isSuper => {
    expect(await getKeyRequestNotifications(7, isSuper)).toEqual({ approved: 2, pending: isSuper ? 2 : 0 });
    expect(queries).toHaveLength(isSuper ? 2 : 1);
    expect(queries[0].sql).toContain("`keyGenerationRequests`.`requestedById` = ?");
    expect(queries[0].sql).toContain("`keyGenerationRequests`.`resultReadAt` is null");
    expect(queries[0].params).toEqual([7, "APPROVED"]);
    if (isSuper) expect(queries[1].params).toEqual(["PENDING"]);
    for (const query of queries) {
      expect(query.sql).toMatch(/^select count\(\*\)/);
      expect(query.sql).not.toContain("keyString");
    }
  });

  it("acknowledges only explicit IDs owned by the current applicant and already approved", async () => {
    await markKeyRequestResultsRead(7, [12, 13, 12]);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("`keyGenerationRequests`.`id` in (?, ?)");
    expect(queries[0].sql).toContain("`keyGenerationRequests`.`requestedById` = ?");
    expect(queries[0].sql).toContain("`keyGenerationRequests`.`resultReadAt` is null");
    expect(queries[0].params.slice(-4)).toEqual([12, 13, 7, "APPROVED"]);
  });

  it("does not issue an unbounded update for an empty list", async () => {
    await markKeyRequestResultsRead(7, []);
    expect(queries).toHaveLength(0);
  });

  it("does not report a successful acknowledgement or empty counts when storage is unavailable", async () => {
    fixture.db = undefined;
    await expect(getKeyRequestNotifications(7, false)).rejects.toThrow("Database not available");
    await expect(markKeyRequestResultsRead(7, [12])).rejects.toThrow("Database not available");
  });
});
