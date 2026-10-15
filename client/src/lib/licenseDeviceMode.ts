export type LicenseDeviceMode = "unlimited" | "limited";

/** Parse the visible computer limit without turning an empty or fractional value into an allowance. */
export function parseDeviceLimit(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 1 && number <= 10000 ? number : null;
}

/** A v4 offline code still needs a modern client after its server allowance becomes unlimited. */
export function deviceLimitLabel(limit?: number, restricted = false): string {
  return limit && limit > 0 ? `${limit} 台` : restricted ? "不限量（新版授权）" : "不限量";
}
