type DateValue = Date | string | number;

export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Calendar labels use UTC+8 regardless of the browser or server's local zone. */
export function beijingDateKey(value: DateValue) {
  return new Date(new Date(value).getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** Convert an already validated YYYY-MM-DD filter into an absolute midnight. */
export function beijingDayStartMs(date: string) {
  return Date.parse(`${date}T00:00:00+08:00`);
}

export function formatBeijingDate(value: DateValue) {
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export function formatBeijingDateTime(value: DateValue) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
