import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const storage = vi.hoisted(() => ({ getKeyRequestNotifications: vi.fn(), markKeyRequestResultsRead: vi.fn() }));
vi.mock("./keyRequestNotifications", () => storage);
import { appRouter } from "./routers";

function caller(role: "user" | "admin" | "super_admin" | null, isActive = true) {
  return appRouter.createCaller({ user: role ? { id: 7, role, isActive } : null,
    req: { headers: {} }, res: { setHeader: vi.fn() },
  } as unknown as TrpcContext);
}

beforeEach(() => {
  vi.resetAllMocks();
  storage.getKeyRequestNotifications.mockResolvedValue({ approved: 1, pending: 0 });
});

describe("request notice permissions", () => {
  it.each(["user", "admin", "super_admin"] as const)("derives %s identity and global approval access from the session", async role => {
    await expect(caller(role).keyGenerationRequests.notifications()).resolves.toEqual({ approved: 1, pending: 0 });
    expect(storage.getKeyRequestNotifications).toHaveBeenCalledWith(7, role === "super_admin");
    await caller(role).keyGenerationRequests.markResultsRead({ ids: [12] });
    expect(storage.markKeyRequestResultsRead).toHaveBeenCalledWith(7, [12]);
  });

  it.each([null, "user", "admin", "super_admin"] as const)("rejects an anonymous or disabled %s session", async role => {
    await expect(caller(role, false).keyGenerationRequests.notifications()).rejects.toMatchObject({ code: role ? "FORBIDDEN" : "UNAUTHORIZED" });
    await expect(caller(role, false).keyGenerationRequests.markResultsRead({ ids: [12] })).rejects.toMatchObject({ code: role ? "FORBIDDEN" : "UNAUTHORIZED" });
    expect(storage.getKeyRequestNotifications).not.toHaveBeenCalled();
    expect(storage.markKeyRequestResultsRead).not.toHaveBeenCalled();
  });

  it.each([[], [0], [-1], [1.5], Array(101).fill(1)])("rejects malformed or unbounded acknowledgements (%#)", async ids => {
    await expect(caller("user").keyGenerationRequests.markResultsRead({ ids })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.markKeyRequestResultsRead).not.toHaveBeenCalled();
  });

  it("does not let callers supply another applicant's ID", async () => {
    await expect(caller("user").keyGenerationRequests.markResultsRead({ ids: [12], userId: 999 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.markKeyRequestResultsRead).not.toHaveBeenCalled();
  });
});
