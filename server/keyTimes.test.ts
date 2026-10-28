import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyStatusHistory, licenseKeys, offlineKeys } from "../drizzle/schema";
import { formatBeijingDate, formatBeijingDateTime } from "../shared/time";

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fixture.db }));
import {
  getKeyStatusHistoryList, getLicenseKeyById, getLicenseKeyByString, getLicenseKeys,
  getOfflineKeys, getTamperedKeys, updateLicenseKeyCategory,
} from "./db";

const queries: string[] = [];
const createdEpoch = 1793094744;
const expiry = 1795686744244;
let deviceLimit = 0;
beforeEach(() => {
  queries.length = 0;
  deviceLimit = 0;
  vi.stubEnv("DATABASE_URL", "mysql://unused:unused@localhost/unused");
  fixture.db = drizzle(async query => {
    queries.push(query);
    if (query.startsWith("select count(")) return { rows: [[1]] };
    if (!query.startsWith("select")) return { rows: [{ affectedRows: 0 }] };
    const table = query.includes("from `offlineKeys`") ? offlineKeys
      : query.includes("from `keyStatusHistory`") ? keyStatusHistory : licenseKeys;
    const data: Record<string, unknown> = {
      id: 524, keyString: "SYNTHETIC-NOT-A-LICENSE", createdAt: String(createdEpoch), updatedAt: String(createdEpoch + 1),
      expireTimestamp: expiry, expireDate: expiry, days: 30, createdById: 7,
      activatedAt: "2026-10-27 09:52:24", tamperedAt: "2026-10-27 10:00:00",
    };
    const row = Object.keys(getTableColumns(table)).map(name => data[name] ?? null);
    if (query.includes("left join `license_device_policies`")) row.push(deviceLimit, deviceLimit > 0 ? 1 : 0);
    return { rows: [row] };
  });
});
afterEach(() => vi.unstubAllEnvs());

function expectCreatedAt(row: { createdAt: Date }) {
  expect(row.createdAt.toISOString()).toBe("2026-10-27T09:52:24.000Z");
  expect(formatBeijingDate(row.createdAt)).toBe("2026/10/27");
  expect(formatBeijingDateTime(row.createdAt)).toBe("2026/10/27 17:52:24");
  expect(queries.some(query => /UNIX_TIMESTAMP\((`\w+`\.)?`createdAt`\)/.test(query))).toBe(true);
}

describe("key metadata timestamps", () => {
  it.each(["unlimited", "limited"] as const)("corrects online and offline %s lists without shifting expiry or device limits", async mode => {
    deviceLimit = mode === "limited" ? 3 : 0;
    const online = await getLicenseKeys({ userIds: [7], page: 1, pageSize: 20, deviceMode: mode });
    const offline = await getOfflineKeys({ userIds: [7], page: 1, pageSize: 20, deviceMode: mode });
    expectCreatedAt(online.items[0]);
    expectCreatedAt(offline.items[0]);
    expect(online.items[0].expireTimestamp).toBe(expiry);
    expect(offline.items[0].expireDate).toBe(expiry);
    expect(online.items[0].deviceLimit).toBe(deviceLimit);
    expect(offline.items[0].deviceLimit).toBe(deviceLimit);
    expect(online.items[0].activatedAt?.toISOString()).toBe("2026-10-27T09:52:24.000Z");
    expect(online.total).toBe(1);
    expect(offline.total).toBe(1);
  });

  it("keeps ID, original-key verification and category-update results consistent", async () => {
    expectCreatedAt((await getLicenseKeyById(524))!);
    expectCreatedAt((await getLicenseKeyByString("SYNTHETIC-NOT-A-LICENSE"))!);
    expectCreatedAt((await updateLicenseKeyCategory(524, "production"))!);
  });

  it("corrects abnormal-list creation times without altering application-written detection times", async () => {
    const result = await getTamperedKeys([7]);
    expectCreatedAt(result.items[0]);
    expect(result.items[0].tamperedAt?.toISOString()).toBe("2026-10-27T10:00:00.000Z");
  });

  it("reads the actual instant of database-generated status-history entries", async () => {
    expectCreatedAt((await getKeyStatusHistoryList("online", 524))[0]);
  });

  it.each(["UTC", "Asia/Shanghai", "America/Los_Angeles"])("formats Beijing calendar dates regardless of runtime timezone %s", timezone => {
    vi.stubEnv("TZ", timezone);
    expect(formatBeijingDate(createdEpoch * 1000)).toBe("2026/10/27");
    expect(formatBeijingDateTime(new Date(createdEpoch * 1000))).toBe("2026/10/27 17:52:24");
    expect(formatBeijingDate("2026-10-27T16:00:00Z")).toBe("2026/10/28");
    expect(formatBeijingDateTime("2026-10-27T16:00:00Z")).toBe("2026/10/28 00:00:00");
  });
});
