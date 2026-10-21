/** Product identity is independent of online/offline and production/rental categories. */
export const LICENSE_PRODUCT_TYPES = ["shroom-desktop", "shroom-sdk"] as const;
export type LicenseProductType = typeof LICENSE_PRODUCT_TYPES[number];

/** Missing product identity belongs exclusively to the historical desktop product. */
export function normalizeLicenseProduct(value: unknown): LicenseProductType {
  if (value == null) return "shroom-desktop";
  if (value === "shroom-desktop" || value === "shroom-sdk") return value;
  throw new Error("LICENSE_PRODUCT_INVALID");
}

/** SDK access covers every device model, including generic serial protocols. */
export function licenseSdkFeatures(productType: LicenseProductType): string[] {
  return productType === "shroom-sdk"
    ? ["serial", "stream", "recording", "serial.raw"] : [];
}

export const LICENSE_PRODUCT_LABELS: Record<LicenseProductType, string> = {
  "shroom-desktop": "Shroom 上位机",
  "shroom-sdk": "Shroom SDK",
};
