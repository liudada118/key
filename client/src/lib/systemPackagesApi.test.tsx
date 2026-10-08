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
});
