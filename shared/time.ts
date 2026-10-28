type DateValue = Date | string | number;

export function formatBeijingDate(value: DateValue) {
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export function formatBeijingDateTime(value: DateValue) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}
