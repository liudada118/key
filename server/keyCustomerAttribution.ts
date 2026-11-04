import { sql } from "drizzle-orm";
import { keyGenerationRequests, licenseKeys } from "../drizzle/schema";

// Historical requests already contain the attribution, so no data rewrite is needed.
const requestReason = sql`(SELECT ${keyGenerationRequests.reason} FROM ${keyGenerationRequests}
  WHERE ${keyGenerationRequests.id} = ${licenseKeys.generationRequestId} LIMIT 1)`;
const note = sql`NULLIF(CONCAT_WS('；', NULLIF(TRIM(${requestReason}), ''), NULLIF(TRIM(${licenseKeys.remark}), '')), '')`;
const noContract = sql`(${licenseKeys.contractId} IS NULL AND NULLIF(TRIM(${licenseKeys.contractNo}), '') IS NULL)`;
export const licenseInternalUse = sql`(${licenseKeys.customerId} IS NULL AND ${noContract} AND LOCATE('自用', COALESCE(${note}, '')) > 0)`;
export const licenseCustomerDisplayName = sql<string | null>`COALESCE(NULLIF(TRIM(${licenseKeys.customerName}), ''),
  CASE WHEN ${noContract} THEN LEFT(CASE WHEN ${licenseInternalUse} THEN NULLIF(TRIM(${licenseKeys.createdByName}), '') ELSE ${note} END, 256) END)`;
