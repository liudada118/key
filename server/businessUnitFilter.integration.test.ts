import { randomUUID } from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getCustomerDashboardRecords, getCustomerNameRecords, getCustomers, getDb } from "./db";

const adminUrl = process.env.CUSTOMER_SYNC_TEST_ADMIN_URL;

describe.skipIf(!adminUrl)("customer department ID filtering in MySQL", () => {
  let admin: Connection;
  const databaseName = `department_filter_test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    url.pathname = `/${databaseName}`;
    vi.stubEnv("DATABASE_URL", url.toString());
    await admin.query(`CREATE TABLE \`${databaseName}\`.customers (id int PRIMARY KEY, name varchar(256),
      contactPerson varchar(128), phone varchar(32), email varchar(320), address text, remark text,
      createdById int NOT NULL, isActive boolean NOT NULL, createdAt timestamp DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp DEFAULT CURRENT_TIMESTAMP)`);
    await admin.query(`CREATE TABLE \`${databaseName}\`.licenseKeys (customerId int, status varchar(32))`);
    await admin.query(`CREATE TABLE \`${databaseName}\`.offlineKeys (customerId int, status varchar(32))`);
    for (let id = 1; id <= 7; id += 1) {
      await admin.query(`INSERT INTO \`${databaseName}\`.customers (id,name,createdById,isActive,createdAt) VALUES (?,?,?,?,?)`,
        [id, `Customer ${id}`, id === 7 ? 2 : 1, id !== 6, new Date(Date.UTC(2026, 9, 16, 7 - id))]);
    }
    await admin.query(`INSERT INTO \`${databaseName}\`.licenseKeys VALUES (3,'ACTIVATED'),(3,'REVOKED')`);
    await admin.query(`INSERT INTO \`${databaseName}\`.offlineKeys VALUES (3,'ISSUED')`);
  });
  afterAll(async () => {
    if (admin) {
      const db = await getDb();
      await db?.$client.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
    vi.unstubAllEnvs();
  });

  it("filters and counts before pagination without bypassing customer ownership", async () => {
    const result = await getCustomers({ userIds: [1], customerIds: [1, 3, 5, 7], page: 2, pageSize: 2 });
    expect(result.total).toBe(3);
    expect(result.items.map(item => item.id)).toEqual([5]);
  });
  it("keeps search, active state and online/offline key counts", async () => {
    const result = await getCustomers({ userIds: [1], customerIds: [3, 6, 7], search: "Customer", isActive: true, page: 1, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: 3, keyCount: 2 });
  });
  it("distinguishes no matches from all, including manually created or inactive profiles in all", async () => {
    expect(await getCustomers({ userIds: [1], customerIds: [], page: 1, pageSize: 20 })).toEqual({ items: [], total: 0 });
    expect((await getCustomers({ userIds: [1], page: 1, pageSize: 20 })).total).toBe(6);
  });
  it("reads only visible customer names, including inactive profiles", async () => {
    const names = await getCustomerNameRecords([1]);
    expect(names).toHaveLength(6);
    expect(names.map(item => item.id)).not.toContain(7);
    expect(await getCustomerNameRecords([])).toEqual([]);
  });
  it("projects all dashboard records including inactive profiles without private fields or pagination", async () => {
    const rows = await getCustomerDashboardRecords([1]);
    expect(rows).toHaveLength(6);
    expect(rows.find(row => row.id === 6)?.isActive).toBe(false);
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "isActive", "name"]);
    expect(await getCustomerDashboardRecords([])).toEqual([]);
    expect((await getCustomerDashboardRecords([1], "Customer 3")).map(row => row.id)).toEqual([3]);
  });
});
