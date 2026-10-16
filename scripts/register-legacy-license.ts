import "dotenv/config";
import { parseArgs } from "node:util";
import { registerLegacyOnlineLicense } from "../server/legacyLicenseImport";

/** Read one bounded secret from redirected stdin so it never becomes a command argument or log entry. */
async function readKeyFromStdin() {
  if (process.stdin.isTTY) throw new Error("STDIN_REQUIRED");
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > 8192) throw new Error("LICENSE_TOO_LARGE");
  }
  return input;
}

/** Default to a read-only preview; applying requires a current active super administrator and review reason. */
async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false },
    "operator-id": { type: "string" }, reason: { type: "string" } } });
  const keyString = await readKeyFromStdin();
  const result = await registerLegacyOnlineLicense({ keyString, operatorId: Number(values["operator-id"]),
    reason: values.reason || "", apply: values.apply });
  console.log(JSON.stringify(result));
}

main().then(() => process.exit(0)).catch(error => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "LEGACY_REGISTRATION_FAILED";
  console.error(JSON.stringify({ error: code }));
  process.exit(1);
});
