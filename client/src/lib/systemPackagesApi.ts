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
  if (!response.ok) throw new Error(result?.error || `系统服务返回 HTTP ${response.status}`);
  return result;
}
