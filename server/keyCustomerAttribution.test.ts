import { describe, expect, it } from "vitest";
import { noContractCustomerName } from "../shared/keyCustomerAttribution";
import { prepareOnlineKeyGeneration } from "./onlineKeyGeneration";

describe("no-contract display attribution", () => {
  it("uses notes without inventing a customer binding", () => {
    expect(noContractCustomerName({ reason: " 客户演示 ", remark: " 测试 " })).toBe("客户演示；测试");
    expect(noContractCustomerName({ remark: "客户乙" })).toBe("客户乙");
    expect(noContractCustomerName({ remark: "  " })).toBeNull();
  });
  it("uses the applicant account name when either note contains self-use", () => {
    expect(noContractCustomerName({ reason: "销售自用", accountName: "员工甲" })).toBe("员工甲");
    expect(noContractCustomerName({ reason: "演示", remark: "自用", accountName: "employee" })).toBe("employee");
  });
  it("bounds the display name but leaves the full note untouched", () => {
    const note = "测".repeat(1000);
    expect(noContractCustomerName({ reason: note })).toHaveLength(256);
    expect(note).toHaveLength(1000);
  });
  it.each(["single", "batch"] as const)("preserves ownership and scope when generating %s without a contract", mode => {
    const result = prepareOnlineKeyGeneration({ mode, sensorTypes: "hand", days: 30, count: 2, category: "production",
      createdById: 7, createdByName: "员工甲", remark: "部门自用" });
    expect(result.records.every(row => row.customerName === "员工甲" && row.customerId === null
      && row.createdById === 7 && row.days === 30 && row.sensorType === "hand")).toBe(true);
  });
  it("does not replace a real customer or infer attribution for a contract with a missing customer", () => {
    const params = { mode: "single" as const, sensorTypes: "hand", days: 30, count: 1,
      category: "production" as const, createdById: 7, createdByName: "员工甲", remark: "自用" };
    expect(prepareOnlineKeyGeneration({ ...params, customerId: 1, customerName: "公司甲" }).records[0].customerName).toBe("公司甲");
    expect(prepareOnlineKeyGeneration({ ...params, contractId: -1, contractNo: "HT-1" }).records[0].customerName).toBeNull();
  });
});
