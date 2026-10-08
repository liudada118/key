import { afterEach, describe, expect, it, vi } from "vitest";
import { systemPackagesApi } from "./systemPackagesApi";

describe("company system API response", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("replaces an HTML fallback with an actionable service message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><html></html>", {
      headers: { "content-type": "text/html" }, status: 200,
    })));
    await expect(systemPackagesApi("/available")).rejects.toThrow("公司系统服务尚未就绪");
  });

  it("returns published systems from a JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ systems: [{ systemId: "seatpad", name: "坐垫" }] })));
    await expect(systemPackagesApi("/available")).resolves.toEqual({ systems: [{ systemId: "seatpad", name: "坐垫" }] });
  });

  it("preserves an occupied ID and its version for explicit update confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "SYSTEM_ID_ALREADY_PUBLISHED", currentVersion: 7 }, { status: 409 })));
    const failure = await systemPackagesApi("/submissions", { method: "POST", body: "{}" }).catch((error) => error);
    expect(failure).toMatchObject({ code: "SYSTEM_ID_ALREADY_PUBLISHED", currentVersion: 7 });
    expect(failure.message).toContain("发布版本 #7");
  });
});
