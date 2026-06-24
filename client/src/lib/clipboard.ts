/**
 * 复制文本到剪贴板。
 *
 * `navigator.clipboard` 只在安全上下文(HTTPS 或 localhost)可用;线上若用
 * HTTP/IP 直接访问,它是 undefined,直接调 `.writeText` 会抛
 * "Cannot read properties of undefined"。这里优先用 Clipboard API,
 * 不可用时降级为 textarea + execCommand("copy")。
 *
 * @returns 是否复制成功
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 安全上下文下仍失败(如权限被拒),继续走下面的降级方案
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
