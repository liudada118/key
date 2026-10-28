import { getTableName } from "drizzle-orm";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { keyStatusHistory, licenseDevicePolicies, licenseKeys, offlineKeys } from "../drizzle/schema";

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("drizzle-orm/mysql2", async importOriginal => ({
  ...await importOriginal<typeof import("drizzle-orm/mysql2")>(), drizzle: () => fixture.db,
}));
import {
  getKeyStatusHistoryList, getLicenseKeyById, getLicenseKeyByString, getLicenseKeys,
  getOfflineKeys, getTamperedKeys, updateLicenseKeyCategory,
} from "./db";

const testUrl = process.env.KEY_TIME_TEST_URL;
describe.skipIf(!testUrl)("license timestamps in a migrated local MySQL database", () => {
  let connection: Connection;
  const tables = [licenseKeys, offlineKeys, licenseDevicePolicies, keyStatusHistory].map(getTableName);
  const epoch = 1793094744;
  const expiry = 1893456000000;
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    connection = await mysql.createConnection(url.toString());
    // Clone structure only. All reads and writes below target connection-local
    // temporary tables, never the application's actual licenses or policies.
    for (const table of tables) {
      const [rows] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      const ddl = (rows as { "Create Table": string }[])[0]["Create Table"];
      if (!ddl.toLowerCase().startsWith(`create table \`${table.toLowerCase()}\``)) throw new Error("Unexpected fixture table definition");
      await connection.query(ddl.replace(/^CREATE TABLE /, "CREATE TEMPORARY TABLE "));
    }
    const { drizzle } = await vi.importActual<typeof import("drizzle-orm/mysql2")>("drizzle-orm/mysql2");
    fixture.db = drizzle(connection);
    vi.stubEnv("DATABASE_URL", testUrl!);
  });
  afterAll(async () => { await connection?.end(); vi.unstubAllEnvs(); });

  it.each(["+08:00", "+00:00", "-07:00"])("preserves online/offline list, verification, abnormal and history instants with session %s", async timezone => {
    await connection.query("SET SESSION time_zone = ?", [timezone]);
    for (const table of tables) await connection.query(`DELETE FROM \`${table}\``);
    for (const id of [1, 2]) {
      await connection.execute(`INSERT INTO licenseKeys
        (id,keyString,sensorType,category,days,expireTimestamp,createdById,status,createdAt,updatedAt,activatedAt,tamperedAt)
        VALUES (?,?,'hand','production',30,?,7,'TAMPERED',FROM_UNIXTIME(?),FROM_UNIXTIME(?),
          '2026-10-27 09:52:24','2026-10-27 10:00:00')`, [id, `synthetic-${id}`, expiry, epoch, epoch + 1]);
      await connection.execute(`INSERT INTO offlineKeys
        (id,machineId,sensorTypes,expireDate,days,activationCode,rsaKeyPairId,createdById,createdAt,updatedAt)
        VALUES (?,'synthetic-machine','hand',?,30,'e30=',1,7,FROM_UNIXTIME(?),FROM_UNIXTIME(?))`, [id, expiry, epoch, epoch + 1]);
    }
    await connection.query("INSERT INTO license_device_policies (key_type,key_id,max_devices) VALUES ('online',2,3),('offline',2,3)");
    await connection.execute(`INSERT INTO keyStatusHistory (keyType,keyId,toStatus,actorId,createdAt)
      VALUES ('online',1,'TAMPERED',7,FROM_UNIXTIME(?))`, [epoch]);
    for (const deviceMode of ["unlimited", "limited"] as const) {
      const options = { userIds: [7], page: 1, pageSize: 20, deviceMode };
      const online = await getLicenseKeys(options), offline = await getOfflineKeys(options);
      expect(online.total).toBe(1);
      expect(offline.total).toBe(1);
      for (const row of [online.items[0], offline.items[0]]) {
        expect(row.createdAt.toISOString()).toBe("2026-10-27T09:52:24.000Z");
        expect(row.updatedAt.getTime()).toBe((epoch + 1) * 1000);
        expect(row.deviceLimit).toBe(deviceMode === "limited" ? 3 : 0);
      }
      expect(online.items[0].expireTimestamp).toBe(expiry);
      expect(offline.items[0].expireDate).toBe(expiry);
      expect(online.items[0].activatedAt?.toISOString()).toBe("2026-10-27T09:52:24.000Z");
    }
    expect((await getLicenseKeyById(1))?.createdAt.getTime()).toBe(epoch * 1000);
    expect((await getLicenseKeyByString("synthetic-1"))?.createdAt.getTime()).toBe(epoch * 1000);
    expect((await updateLicenseKeyCategory(1, "rental"))?.createdAt.getTime()).toBe(epoch * 1000);
    const abnormal = await getTamperedKeys([7]);
    expect(abnormal.total).toBe(2);
    expect(abnormal.items[0].createdAt.getTime()).toBe(epoch * 1000);
    expect(abnormal.items[0].tamperedAt?.toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect((await getKeyStatusHistoryList("online", 1))[0].createdAt.getTime()).toBe(epoch * 1000);
    const [persisted] = await connection.query("SELECT UNIX_TIMESTAMP(createdAt) AS epoch, expireTimestamp AS expiry FROM licenseKeys WHERE id=1");
    expect(persisted).toMatchObject([{ epoch, expiry }]);
  });
});
