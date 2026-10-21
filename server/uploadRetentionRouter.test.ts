import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { uploadRetentionRouter } from "./uploadRetentionRouter";
import { cleanupExpiredUploads, deleteUploadedIdentity } from "./uploadRetention";
vi.mock("./uploadRetention", () => ({ cleanupExpiredUploads: vi.fn(async () => ({ dryRun: true })),
  deleteUploadedIdentity: vi.fn(async () => ({ deleted: 1 })), listUploadDeletionAudit: vi.fn(async () => []),
  uploadRetentionPolicy: () => ({ chatDays: 180, usageDays: 90 }) }));
/** Build a caller without cookies or real database credentials. */
function caller(role: string, active = true) {
  return uploadRetentionRouter.createCaller({ user: { id: 7, role, isActive: active }, res: { setHeader: vi.fn() } } as unknown as TrpcContext);
}
describe("upload retention administration", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects ordinary administrators, users, and disabled super administrators", async () => {
    for (const [role, active] of [["user", true], ["admin", true], ["super_admin", false]] as const) {
      await expect(caller(role, active).policy()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role, active).cleanup({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role, active).audit()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(cleanupExpiredUploads).not.toHaveBeenCalled();
  });
  it("defaults to preview and requires an explicit confirmation for bounded destructive cleanup", async () => {
    await caller("super_admin").cleanup({});
    expect(cleanupExpiredUploads).toHaveBeenCalledWith({ dryRun: true, limit: 100, actorId: 7 });
    await expect(caller("super_admin").cleanup({ dryRun: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller("super_admin").cleanup({ dryRun: false, confirmation: "DELETE_EXPIRED_UPLOADS", limit: 500 });
    await expect(caller("super_admin").cleanup({ limit: 501 })).rejects.toThrow();
  });
  it("requires complete source identity and confirmation for a manual deletion", async () => {
    const key = { kind: "chat" as const, sourceId: 9, installationId: "249c3777-cff6-44e4-99ea-a812e302a992", objectId: "conversation" };
    await caller("super_admin").delete({ ...key, confirmation: "DELETE_UPLOADED_DATA" });
    expect(deleteUploadedIdentity).toHaveBeenCalledWith({ ...key, confirmation: "DELETE_UPLOADED_DATA" }, 7);
    await expect(caller("super_admin").delete({ ...key, confirmation: "wrong" as any })).rejects.toThrow();
  });
});
