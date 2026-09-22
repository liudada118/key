import "dotenv/config";
import { parseArgs } from "node:util";
import { z } from "zod";
import { getActiveSuperAdmin } from "../server/db";
import { AgentSyncError, issueUploadCredential, listUploadCredentials, revokeUploadCredential } from "../server/agentSyncStore";

// Local operator utility: requires access to the server's DATABASE_URL.
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    "customer-id": { type: "string" }, "admin": { type: "string" },
    "name": { type: "string" }, "days": { type: "string" }, "id": { type: "string" },
  } });
  const command = z.enum(["issue", "list", "revoke"]).parse(positionals[0]);
  const adminName = z.string().min(1).parse(values.admin);
  const admin = await getActiveSuperAdmin(adminName);
  if (!admin) throw new Error("Active super administrator not found");
  if (command === "revoke") {
    const id = z.coerce.number().int().positive().parse(values.id);
    await revokeUploadCredential(id);
    console.log(JSON.stringify({ revoked: true, id }));
    return;
  }
  const tenantId = z.coerce.number().int().positive().parse(values["customer-id"]);
  if (command === "list") {
    console.log(JSON.stringify(await listUploadCredentials(tenantId), null, 2));
    return;
  }
  const name = z.string().trim().min(1).max(128).parse(values.name);
  const days = z.coerce.number().int().min(1).max(365).parse(values.days ?? "90");
  const credential = await issueUploadCredential({ tenantId, name, days, createdById: admin.id });
  console.log(JSON.stringify(credential, null, 2));
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error instanceof AgentSyncError ? error.code : "Command failed: check arguments, active admin, customer and database configuration.");
  process.exit(1);
});
