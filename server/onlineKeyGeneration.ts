import { nanoid } from "nanoid";
import type { InsertLicenseKey } from "../drizzle/schema";
import { generateLicenseKey } from "@shared/crypto";
import { normalizeLicenseFile } from "@shared/licenseScopes";

export type OnlineGenerationMode = "single" | "batch";

export function prepareOnlineKeyGeneration(params: {
  mode: OnlineGenerationMode;
  sensorTypes: string | string[];
  days: number;
  category: "production" | "rental";
  count: number;
  createdById: number;
  createdByName: string;
  customerId?: number | null;
  customerName?: string | null;
  contractId?: number | null;
  contractNo?: string | null;
  generationRequestId?: number | null;
  remark?: string | null;
}) {
  const batchId = params.mode === "batch" ? nanoid(12) : null;
  // sensorType 列原样存令牌串（如 "@group:precision" / "@group:care,humanBodyOptimized"），
  // 不在这里展开成系统列表 —— 否则 reissueLicenseKey 重签时会把分类语义固化成签发当时的成员。
  // 归一化后与密钥 payload 的 file 字段逐字一致，便于两边对照。
  const file = normalizeLicenseFile(params.sensorTypes);
  const sensorType = Array.isArray(file) ? file.join(",") : file;
  const keys: { keyString: string; expireTimestamp: number }[] = [];
  const records: InsertLicenseKey[] = [];

  for (let index = 0; index < params.count; index += 1) {
    const keyString = generateLicenseKey(
      params.sensorTypes,
      params.days,
      params.category,
    );
    const expireTimestamp = Date.now() + params.days * 24 * 60 * 60 * 1000;
    keys.push({ keyString, expireTimestamp });
    records.push({
      keyString,
      sensorType,
      category: params.category,
      days: params.days,
      expireTimestamp,
      createdById: params.createdById,
      createdByName: params.createdByName,
      customerId: params.customerId || null,
      customerName: params.customerName || null,
      contractId: params.contractId || null,
      contractNo: params.contractNo || null,
      generationRequestId: params.generationRequestId || null,
      batchId,
      remark: params.remark || null,
    });
  }

  return { batchId, keys, records };
}
