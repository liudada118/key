import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { usageIdentity } from "./usageIdentity";

export type UsageReadScope = { kind: "all" } | { kind: "issuer"; issuerId: number };

/** Only server session data may choose the scope; client filters can only narrow it. */
export function usageReadScope(user: { id: number; role: string; isActive: boolean }): UsageReadScope {
  if (!user.isActive || !Number.isSafeInteger(user.id) || user.id <= 0
    || !["user", "admin", "super_admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不可查看使用分析" });
  }
  return user.role === "super_admin" ? { kind: "all" } : { kind: "issuer", issuerId: user.id };
}

/** Apply before aggregation; shared customers never confer access to another issuer's keys. */
export function usageOwnerCondition(scope: UsageReadScope) {
  if (scope?.kind === "all") return undefined;
  if (scope?.kind !== "issuer" || !Number.isSafeInteger(scope.issuerId) || scope.issuerId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "缺少使用分析访问范围" });
  }
  return eq(usageIdentity.createdById, scope.issuerId);
}
