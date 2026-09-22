import { describe, expect, it, vi } from "vitest";
import { agentSyncRouter } from "./agentSyncRouter";
import type { TrpcContext } from "./_core/context";
import { getAgentConversation, issueUploadCredential, listAgentConversations } from "./agentSyncStore";
vi.mock("./agentSyncStore", () => ({
  AgentSyncError: class extends Error {},
  issueUploadCredential: vi.fn(async () => ({ token: "issued-once" })),
  listUploadCredentials: vi.fn(async () => []),
  revokeUploadCredential: vi.fn(async () => {}),
  listAgentChatCustomers: vi.fn(async () => []),
  listAgentConversations: vi.fn(async () => ({ items: [], total: 0, page: 1 })),
  getAgentConversation: vi.fn(async () => null),
}));

function caller(role: string, isActive = true) {
  return agentSyncRouter.createCaller({ user: { id: 7, role, isActive }, res: { setHeader: vi.fn() } } as unknown as TrpcContext);
}
describe("Agent upload credential administration", () => {
  it("restricts every operation to active super administrators", async () => {
    for (const [role, active] of [["user", true], ["admin", true], ["super_admin", false]] as const) {
      const client = caller(role, active);
      await expect(client.issueCredential({ customerId: 1, name: "Test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.listCredentials({ customerId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.revokeCredential({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.chatCustomers()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.conversations({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.conversation({ customerId: 1, installationId: "249c3777-cff6-44e4-99ea-a812e302a992", conversationId: "test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("requires a complete tenant/install/conversation key for chat details", async () => {
    const key = { customerId: 42, installationId: "249c3777-cff6-44e4-99ea-a812e302a992", conversationId: "test" };
    await caller("super_admin").conversations({ customerId: 42 });
    expect(listAgentConversations).toHaveBeenCalledWith({ customerId: 42, page: 1, pageSize: 20 });
    await expect(caller("super_admin").conversation(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getAgentConversation).toHaveBeenCalledWith({ ...key, messagePage: 1, taskPage: 1 });
    await expect(caller("super_admin").conversations({ pageSize: 999 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("issues a credential using the caller identity and bounded expiry", async () => {
    await caller("super_admin").issueCredential({ customerId: 42, name: "Test" });
    expect(issueUploadCredential).toHaveBeenCalledWith({ tenantId: 42, name: "Test", days: 90, createdById: 7 });
    await expect(caller("super_admin").issueCredential({ customerId: 42, name: "Test", days: 9999 })).rejects.toThrow();
  });
});
