import { randomUUID } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { getOrganizationExport } from "./organizationExport";

const adminUrl = process.env.CUSTOMER_SYNC_TEST_ADMIN_URL;
describe.skipIf(!adminUrl)("organization export MySQL snapshot", () => {
  let admin: Connection;
  const databaseName = `organization_export_test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    url.pathname = `/${databaseName}`;
    vi.stubEnv("DATABASE_URL", url.toString());
    await admin.query(`CREATE TABLE \`${databaseName}\`.users (id int PRIMARY KEY, username varchar(64), name text,
      role varchar(32), isActive boolean, managedGroups varchar(256), departmentId int, createdById int,
      password varchar(128), email varchar(320), phone varchar(32))`);
    await admin.query(`CREATE TABLE \`${databaseName}\`.departments (id int PRIMARY KEY, name varchar(128), sensorGroup varchar(64), managerId int)`);
    await admin.query(`INSERT INTO \`${databaseName}\`.departments VALUES (10,'精密事业部','精密',1),(11,'营销中心',NULL,NULL)`);
    for (let id = 1; id <= 25; id += 1) {
      await admin.query(`INSERT INTO \`${databaseName}\`.users VALUES (?,?,?,?,?,NULL,?,?,?,NULL,NULL)`,
        [id, `user${id}`, `人员${id}`, id === 1 ? "admin" : "user", id !== 25, 10, id === 1 ? null : 1, "synthetic-password-hash"]);
    }
  });
  afterAll(async () => {
    if (admin) {
      await (await getDb())?.$client.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
    vi.unstubAllEnvs();
  });
  it("reads every account and department in a consistent read-only transaction without credential columns", async () => {
    const result = await getOrganizationExport();
    expect(result.counts).toEqual({ accounts: 25, departments: 2 });
    expect(result.accounts[24]).toMatchObject({ username: "user25", isActive: false, departmentName: "精密事业部", createdByUsername: "user1" });
    expect(result.departments[0]).toMatchObject({ managerUsername: "user1" });
    expect(JSON.stringify(result)).not.toContain("synthetic-password-hash");
  });
});
