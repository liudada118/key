import { beforeEach, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ getKeyGenerationRequestById: vi.fn(), approveKeyGenerationRequestWithKeys: vi.fn(),
  rejectKeyGenerationRequest: vi.fn(), createAuditLog: vi.fn() }));
vi.mock("./db", () => storage);
import { reviewKeyGenerationRequest } from "./keyGenerationRequestApproval";

beforeEach(() => { vi.resetAllMocks(); storage.approveKeyGenerationRequestWithKeys.mockResolvedValue({ id: 1, status: "APPROVED" }); });
it.each(["website", "feishu"] as const)("preserves requested attribution when approval comes from %s", async source => {
  for (const [reason, expected] of [["客户测试演示", "客户测试演示；备注"], ["销售自用", "申请员工"]]) {
    storage.getKeyGenerationRequestById.mockResolvedValue({ id: 1, requestNo: "KGR-FIXTURE", status: "PENDING", mode: "batch",
      productType: "shroom-desktop", sensorTypes: '"hand"', days: 30, category: "production", count: 2,
      requestedById: 7, requestedByName: "申请员工", reason, generationRemark: "备注" });
    await reviewKeyGenerationRequest({ requestId: 1, decision: "APPROVE", reviewer: { id: 2, name: "审批管理员" }, audit: { source } });
    const { records } = storage.approveKeyGenerationRequestWithKeys.mock.calls.at(-1)![0];
    expect(records).toHaveLength(2);
    expect(records.every((r: { customerName: string; customerId: number | null; createdById: number; generationRequestId: number }) =>
      r.customerName === expected && r.customerId === null && r.createdById === 7 && r.generationRequestId === 1)).toBe(true);
  }
});
