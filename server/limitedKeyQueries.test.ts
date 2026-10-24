import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fixture.db }));
import { getLicenseKeys, getOfflineKeys, getOfflineKeyStats, getKeyCreators } from "./db";

const queries: { sql: string; params: unknown[] }[] = [];

beforeEach(() => {
  queries.length = 0;
  fixture.db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: sql.startsWith("select count(") ? [[0]] : sql.startsWith("select") ? [] : [{ insertId: 0, affectedRows: 0 }] };
  });
  vi.stubEnv("DATABASE_URL", "mysql://unused:unused@localhost/unused");
});

afterEach(() => vi.unstubAllEnvs());

describe("license device category SQL boundaries", () => {
  it.each(["online", "offline"] as const)("ANDs the selected %s creator with visibility in both page and count queries", async keyType => {
    const input = { userIds: [7, 8], page: 2, pageSize: 10, createdById: 999, search: "customer", deviceMode: "unlimited" as const };
    if (keyType === "online") await getLicenseKeys({ ...input, visibleSensorValues: ["hand"] });
    else await getOfflineKeys(input);
    const selects = queries.filter(query => query.sql.startsWith("select"));
    expect(selects).toHaveLength(2);
    const table = keyType === "online" ? "licenseKeys" : "offlineKeys";
    for (const query of selects) {
      const where = query.sql.split("where")[1];
      expect(where).toContain(`\`${table}\`.\`createdById\` in (?, ?)`);
      expect(where).toContain(`and \`${table}\`.\`createdById\` = ?`);
      expect(query.params).toEqual(expect.arrayContaining([7, 8, 999, "%customer%"]));
      expect(where).toContain(`\`${table}\`.\`isDeleted\` = ?`);
    }
  });

  it.each(["online", "offline"] as const)("gets %s creator options only from visible keys, not the account directory", async keyType => {
    await getKeyCreators({ keyType, userIds: [7], visibleSensorValues: ["hand"], deviceMode: "limited" });
    expect(queries).toHaveLength(1);
    const query = queries[0], table = keyType === "online" ? "licenseKeys" : "offlineKeys";
    expect(query.sql).toContain(`from \`${table}\` left join \`users\``);
    expect(query.sql).toContain(`group by \`${table}\`.\`createdById\``);
    expect(query.sql).toContain(`\`${table}\`.\`isDeleted\` = ?`);
    expect(query.sql).toContain("MAX(NULLIF(");
    expect(query.sql).not.toContain("`password`");
    expect(query.sql).not.toContain("`isActive`");
    expect(query.params).toEqual(expect.arrayContaining([keyType, 7, false, 1]));
    if (keyType === "online") expect(query.sql).toContain("FIND_IN_SET");
    else expect(query.sql).not.toContain("FIND_IN_SET");
  });

  it.each(["limited", "unlimited"] as const)("keeps online %s filtering inside both page and count queries", async deviceMode => {
    await getLicenseKeys({ userIds: [7, 8], visibleSensorValues: ["hand"], page: 3, pageSize: 10, customerId: 11, deviceMode });
    const selects = queries.filter(query => query.sql.startsWith("select"));
    expect(selects).toHaveLength(2);
    for (const query of selects) {
      expect(query.sql).toContain("left join `license_device_policies`");
      expect(query.sql).toContain("`licenseKeys`.`createdById` in");
      expect(query.sql).toContain("FIND_IN_SET");
      expect(query.sql).toContain("`licenseKeys`.`isDeleted` =");
      expect(query.sql).toContain("COALESCE(`license_device_policies`.`max_devices`, 0) > 0");
      expect(query.params).toEqual(expect.arrayContaining(["online", 7, 8, "hand", false, deviceMode === "limited" ? 1 : 0, 11]));
    }
    expect(selects[0].sql).toContain("limit ? offset ?");
    expect(selects[0].params.slice(-2)).toEqual([10, 20]);
    expect(selects[1].sql).not.toContain("limit");
  });

  it("does not filter existing callers that omit the device category", async () => {
    await getLicenseKeys({ userIds: [7], page: 1, pageSize: 10 });
    const count = queries.find(query => query.sql.startsWith("select count("))!;
    expect(count.sql.split("where")[1]).not.toContain("max_devices");
  });

  it("uses the same safe offline predicate for items, count, and statistics", async () => {
    await getOfflineKeys({ userIds: [7], page: 1, pageSize: 10, deviceMode: "limited", search: "customer" });
    await getOfflineKeyStats([7], "limited");
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      const condition = query.sql.split("where")[1];
      expect(condition).toContain("`offlineKeys`.`createdById` in");
      expect(condition).toContain("`offlineKeys`.`isDeleted` =");
      expect(condition).toContain("JSON_VALID");
      expect(condition).toContain("FROM_BASE64");
      expect(condition).toContain("'{}'");
      expect(condition).toContain("REGEXP '^[0-9]{1,5}$'");
      expect(condition).toContain("BETWEEN 1 AND 10000");
      expect(query.params).toContain("offline");
    }
    expect(queries[0].sql).toContain("limit ?");
    expect(queries[1].sql).not.toContain("limit ?");
    expect(queries[2].sql).not.toContain("limit ?");
  });
});
