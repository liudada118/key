/** Display attribution only; a remark is not a customer account or an authorization grant. */
export function noContractCustomerName(input: { reason?: string | null; remark?: string | null; accountName?: string | null }) {
  const note = [input.reason?.trim(), input.remark?.trim()].filter(Boolean).join("；");
  const name = note.includes("自用") ? input.accountName?.trim() : note;
  return name ? Array.from(name).slice(0, 256).join("") : null;
}
