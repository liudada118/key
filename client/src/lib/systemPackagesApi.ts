/** Call the company system API without leaking HTML fallback pages into the UI. */
export async function systemPackagesApi(path: string, options?: RequestInit) {
  const response = await fetch(`/api/system-packages${path}`, {
    credentials: "same-origin", ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers },
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("公司系统服务尚未就绪，请联系管理员更新服务器后重试");
  }
  let result: any;
  try { result = await response.json(); }
  catch { throw new Error("公司系统服务返回的数据无法读取，请稍后重试"); }
  const messages: Record<string, string> = {
    SYSTEM_ID_ALREADY_PUBLISHED: `系统 ID 已有发布版本 #${result?.currentVersion}，请确认是更新或更换新 ID`,
    SYSTEM_ID_INCOMPATIBLE: "系统类型或原生来源与已发布版本不一致，请使用新 ID",
    SYSTEM_ID_PENDING: `此 ID 已有待审提交 #${result?.pendingId}，请先处理它`,
    SYSTEM_ID_BUSY: "同一系统 ID 正在被其他人提交，请稍后重试",
    SYSTEM_ID_RESERVED: "此 ID 属于软件内置系统，请换一个 ID",
    SYSTEM_SENSOR_TYPE_RESERVED: "包内传感器类型与内置系统冲突，请更换传感器类型",
    SYSTEM_UPDATE_TARGET_MISSING: "原发布版本已不存在，请重新提交",
    SYSTEM_UPDATE_CONFIRMATION_REQUIRED: "请明确确认要更新的当前版本",
    STATUS_CHANGED: "系统审核状态已变化，请刷新后重试",
    SIGNING_KEY_UNCONFIGURED: "服务器尚未配置公司系统包签名密钥。发布没有完成，请部署管理员配置签名私钥并重启网站服务后重试；无需重新提交系统包",
  };
  if (!response.ok) throw Object.assign(new Error(messages[result?.error] || result?.error || `系统服务返回 HTTP ${response.status}`), {
    code: result?.error, currentVersion: result?.currentVersion, pendingId: result?.pendingId,
  });
  return result;
}
