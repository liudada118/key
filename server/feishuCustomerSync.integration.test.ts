import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let database: ReturnType<typeof drizzle>;
let visibleIds = [1];
vi.mock("./db", () => ({ getDb: async () => database, getUserAndSubordinateIds: async () => visibleIds }));
vi.mock("./feishuContracts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./feishuContracts")>(), getFeishuContracts: vi.fn(),
}));
import { getFeishuContracts } from "./feishuContracts";
import { syncFeishuCustomersForUser } from "./feishuCustomerSync";

const adminUrl = process.env.CUSTOMER_SYNC_TEST_ADMIN_URL;
describe.skipIf(!adminUrl)("Feishu customer import transactions", () => {
  let admin: Connection, pool: Pool;
  const databaseName = `customer_sync_test_${randomUUID().replaceAll("-", "")}`;
  const user = { id: 1, name: "Admin", role: "super_admin" as const, isActive: true };
  let sourceRows: { customerName: string | null; submitter: string }[];
  async function rows(query: string, args: unknown[] = []) {
    return (await pool.query<RowDataPacket[]>(query, args))[0];
  }

  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Integration database must be local");
    admin = await mysql.createConnection(adminUrl!);
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
    url.pathname = `/${databaseName}`;
    pool = mysql.createPool({ uri: url.toString(), connectionLimit: 6 });
    database = drizzle(pool);
    await pool.query("CREATE TABLE users (id int PRIMARY KEY, name text, role varchar(32), isActive boolean)");
    await pool.query("INSERT INTO users VALUES (1,'Admin','super_admin',1),(2,'Other','user',1),(3,'提交人甲','user',1),(4,'AuditFail','super_admin',1)");
    await pool.query(`CREATE TABLE customers (id int AUTO_INCREMENT PRIMARY KEY, name varchar(256) NOT NULL,
      contactPerson varchar(128), phone varchar(32), email varchar(320), address text, remark text,
      createdById int NOT NULL, isActive boolean NOT NULL DEFAULT 1,
      createdAt timestamp DEFAULT CURRENT_TIMESTAMP, updatedAt timestamp DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE auditLogs (id int AUTO_INCREMENT PRIMARY KEY, userId int NOT NULL, userName varchar(128),
      action varchar(32), resourceType varchar(64), resourceId int, \`before\` text, \`after\` text, description text,
      ip varchar(64), userAgent varchar(512), createdAt timestamp DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT audit_failure_fixture CHECK (userId <> 4))`);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM customers");
    await pool.query("DELETE FROM auditLogs");
    await pool.query("UPDATE users SET isActive=1");
    visibleIds = [1];
    sourceRows = [{ customerName: "Alpha", submitter: "提交人甲" }, { customerName: "Beta", submitter: "其他人" }];
    vi.mocked(getFeishuContracts).mockReset();
    vi.mocked(getFeishuContracts).mockImplementation(async (options) => {
      const filtered = options?.submitter ? sourceRows.filter(row => row.submitter === options.submitter) : sourceRows;
      const size = options?.pageSize || 50;
      const start = ((options?.page || 1) - 1) * size;
      return { items: filtered.slice(start, start + size), total: filtered.length, source: "feishu" } as never;
    });
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``); await admin.end(); }
  });

  it("deduplicates names and persists the import audit in the same transaction", async () => {
    sourceRows.push({ customerName: "  ALPHA ", submitter: "提交人甲" });
    expect(await syncFeishuCustomersForUser(user)).toMatchObject({ created: 2, existing: 0, customers: 2, contracts: 3 });
    expect(await rows("SELECT name,createdById,isActive FROM customers ORDER BY name")).toMatchObject([
      { name: "Alpha", createdById: 1, isActive: 1 }, { name: "Beta", createdById: 1, isActive: 1 },
    ]);
    expect(await rows("SELECT * FROM auditLogs")).toHaveLength(1);
  });
  it("does not overwrite existing contact data or reactivate a disabled customer", async () => {
    await pool.query("INSERT INTO customers (name,createdById,isActive,phone,remark) VALUES ('ALPHA',1,0,'12345','manual')");
    expect(await syncFeishuCustomersForUser(user)).toMatchObject({ created: 1, existing: 1 });
    expect(await syncFeishuCustomersForUser(user)).toMatchObject({ created: 0, existing: 2 });
    expect((await rows("SELECT * FROM customers WHERE name='ALPHA'"))[0]).toMatchObject({ isActive: 0, phone: "12345", remark: "manual" });
  });
  it("serializes concurrent retries from the same account", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => syncFeishuCustomersForUser(user)));
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(2);
    expect(await rows("SELECT * FROM customers")).toHaveLength(2);
  });
  it("only imports a child's visible contracts and does not reuse another owner's private customer", async () => {
    await pool.query("INSERT INTO customers (name,createdById) VALUES ('Alpha',2)");
    visibleIds = [3];
    expect(await syncFeishuCustomersForUser({ id: 3, name: "提交人甲", role: "user", isActive: true })).toMatchObject({ created: 1, customers: 1 });
    expect(await rows("SELECT name,createdById FROM customers ORDER BY createdById")).toMatchObject([
      { name: "Alpha", createdById: 2 }, { name: "Alpha", createdById: 3 },
    ]);
    expect(getFeishuContracts).toHaveBeenCalledWith({ submitter: "提交人甲", page: 1, pageSize: 1000 });
  });
  it("rolls back new customers if the audit insert fails", async () => {
    visibleIds = [4];
    await expect(syncFeishuCustomersForUser({ ...user, id: 4, name: "AuditFail" })).rejects.toThrow();
    expect(await rows("SELECT * FROM customers")).toHaveLength(0);
    expect(await rows("SELECT * FROM auditLogs")).toHaveLength(0);
  });
  it("rejects an account disabled while the source was being read", async () => {
    await pool.query("UPDATE users SET isActive=0 WHERE id=1");
    await expect(syncFeishuCustomersForUser(user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await rows("SELECT * FROM customers")).toHaveLength(0);
  });
  it("reads every page before importing, including duplicates across pages", async () => {
    sourceRows = Array.from({ length: 1001 }, (_, index) => ({ customerName: index < 1000 ? "Alpha" : "Beta", submitter: "提交人甲" }));
    expect(await syncFeishuCustomersForUser(user)).toMatchObject({ created: 2, contracts: 1001 });
    expect(getFeishuContracts).toHaveBeenCalledTimes(2);
  });
  it("does not write any customers when reading the source fails", async () => {
    vi.mocked(getFeishuContracts).mockRejectedValue(new Error("source unavailable"));
    await expect(syncFeishuCustomersForUser(user)).rejects.toThrow("source unavailable");
    expect(await rows("SELECT * FROM customers")).toHaveLength(0);
    expect(await rows("SELECT * FROM auditLogs")).toHaveLength(0);
  });
});
