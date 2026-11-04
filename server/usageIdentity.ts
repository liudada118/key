import { eq, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/mysql-core";
import { agentChatSources, customers, licenseKeys, offlineKeys, usageSources } from "../drizzle/schema";
import { licenseCustomerDisplayName, licenseInternalUse } from "./keyCustomerAttribution";

// Resolve presentation at read time. Original receipts and first-upload snapshots stay immutable.
const customerId = sql<number | null>`CASE WHEN ${licenseKeys.id} IS NOT NULL THEN ${licenseKeys.customerId}
  WHEN ${offlineKeys.id} IS NOT NULL THEN ${offlineKeys.customerId} ELSE ${usageSources.customerId} END`;
const isSelf = sql`(${licenseKeys.id} IS NOT NULL AND ${licenseInternalUse})`;
const knownName = sql<string | null>`CASE WHEN ${licenseKeys.id} IS NULL AND ${offlineKeys.id} IS NULL
  THEN CASE WHEN ${usageSources.customerId} IS NOT NULL THEN ${usageSources.customerName} END
  ELSE COALESCE(NULLIF(TRIM(${customers.name}), ''), ${licenseCustomerDisplayName}, NULLIF(TRIM(${offlineKeys.customerName}), '')) END`;
const kind = sql<"company" | "self" | "unbound">`CASE WHEN ${isSelf} THEN 'self'
  WHEN ${customerId} IS NOT NULL OR ${knownName} IS NOT NULL THEN 'company' ELSE 'unbound' END`;

export const usageIdentity = new QueryBuilder().select({
  sourceId: usageSources.sourceId,
  customerId: customerId.as("customer_id"),
  identityScope: kind.as("identity_scope"),
  customerName: sql<string>`CASE WHEN ${isSelf} THEN CONCAT(COALESCE(${knownName}, '账号'), ' · 自用')
    ELSE COALESCE(${knownName}, ${usageSources.customerName}) END`.as("customer_name"),
}).from(usageSources).leftJoin(agentChatSources, eq(agentChatSources.id, usageSources.sourceId))
  .leftJoin(licenseKeys, eq(licenseKeys.id, agentChatSources.licenseKeyId))
  .leftJoin(offlineKeys, eq(offlineKeys.id, agentChatSources.offlineKeyId))
  .leftJoin(customers, eq(customers.id, customerId)).as("usage_identity");
