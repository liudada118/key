import { asc } from "drizzle-orm";
import { departments, users, type Department, type User } from "../drizzle/schema";
import { getDb } from "./db";

type ExportAccount = Pick<User, "id" | "username" | "name" | "role" | "isActive" | "managedGroups" | "departmentId" | "createdById">;
type ExportDepartment = Pick<Department, "id" | "name" | "sensorGroup" | "managerId">;

export function buildOrganizationExport(accounts: ExportAccount[], departmentRows: ExportDepartment[], now = new Date()) {
  const accountsById = new Map(accounts.map(account => [account.id, account]));
  const departmentsById = new Map(departmentRows.map(department => [department.id, department]));
  const usernameById = (id: number | null) => id === null ? null : accountsById.get(id)?.username ?? null;
  return {
    format: "key-manager-organization" as const,
    version: 1 as const,
    exportedAt: now.toISOString(),
    counts: { accounts: accounts.length, departments: departmentRows.length },
    accounts: accounts.map(account => ({
      sourceId: account.id,
      username: account.username,
      name: account.name,
      role: account.role,
      isActive: account.isActive,
      managedGroups: account.managedGroups,
      departmentName: account.departmentId === null ? null : departmentsById.get(account.departmentId)?.name ?? null,
      createdByUsername: usernameById(account.createdById),
    })),
    departments: departmentRows.map(department => ({
      sourceId: department.id,
      name: department.name,
      sensorGroup: department.sensorGroup,
      managerUsername: usernameById(department.managerId),
    })),
  };
}

export async function getOrganizationExport() {
  const db = await getDb();
  if (!db) throw new Error("Organization storage unavailable");
  return db.transaction(async tx => {
    // Project fields at the database boundary; credentials never enter the export pipeline.
    const accounts = await tx.select({ id: users.id, username: users.username, name: users.name, role: users.role,
      isActive: users.isActive, managedGroups: users.managedGroups, departmentId: users.departmentId, createdById: users.createdById })
      .from(users).orderBy(asc(users.id));
    const departmentRows = await tx.select({ id: departments.id, name: departments.name,
      sensorGroup: departments.sensorGroup, managerId: departments.managerId }).from(departments).orderBy(asc(departments.id));
    return buildOrganizationExport(accounts, departmentRows);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
