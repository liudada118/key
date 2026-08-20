/**
 * 授权范围（License Scope）注册表与展开逻辑
 *
 * 分类与系统归属的唯一数据源是 `config/licenseSensorGroups.json`，由桌面端
 * （E:\shroom1）的 `scripts/sync-license-registry.cjs` 同步过来，SHA-256 与桌面端一致。
 * 服务端不得再维护第二份手写分类数组 —— 需要新增/移动系统时改注册表并重新同步。
 *
 * 分类密钥保存稳定的 `@group:<groupKey>` 令牌，**不保存签发当时展开的系统数组**。
 * 这样以后往分类里加系统时，未过期的旧分类密钥在新版客户端里能自动获得新增系统。
 *
 * 本模块是纯逻辑（不碰 fs），可被 shared/crypto.ts 与前端安全引用；
 * 运行时从磁盘热加载注册表的入口见 server/licenseRegistry.ts。
 */
import bundledRegistry from "../config/licenseSensorGroups.json";

/** 分类令牌前缀，与桌面端 licenseScopes.js 保持一致 */
export const GROUP_SCOPE_PREFIX = "@group:";

/** 注册表里的单个展示系统 */
export interface LicenseSensorItem {
  /** 桌面端 i18n 键，仅用于客户端展示 */
  labelKey?: string;
  /** 系统 key —— 协议字段，桌面端逐字比对才能解锁 */
  value: string;
}

/** 注册表里的单个分类 */
export interface LicenseSensorGroup {
  key: string;
  labelKey?: string;
  icon?: string;
  items: LicenseSensorItem[];
}

/** 展开后的授权范围 */
export interface ExpandedLicenseScope {
  /** 是否 "all" 全部授权 */
  isAllTypes: boolean;
  /** 命中的分类 key（按请求顺序、已去重） */
  groupKeys: string[];
  /** 展开后的系统 key（按请求顺序、已去重） */
  sensorTypes: string[];
}

/**
 * 校验注册表结构。分类为空 / 分类 key 重复或非法 / 分类无系统 / 系统 value 全局重复
 * 全部视为致命错误 —— 服务启动时校验失败必须 fail-fast，不能退回空列表继续签发。
 */
export function validateLicenseSensorGroups(
  groups: unknown
): { groupCount: number; sensorTypeCount: number } {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("license sensor groups must be a non-empty array");
  }

  const groupKeys = new Set<string>();
  const sensorTypes = new Set<string>();
  for (const group of groups as LicenseSensorGroup[]) {
    const groupKey = typeof group?.key === "string" ? group.key.trim() : "";
    if (!groupKey || groupKeys.has(groupKey)) {
      throw new Error(`duplicate or invalid license group: ${groupKey || "(empty)"}`);
    }
    if (!Array.isArray(group.items) || group.items.length === 0) {
      throw new Error(`license group has no display systems: ${groupKey}`);
    }
    groupKeys.add(groupKey);

    for (const item of group.items) {
      const sensorType = typeof item?.value === "string" ? item.value.trim() : "";
      if (!sensorType || sensorTypes.has(sensorType)) {
        throw new Error(`duplicate or invalid display system: ${sensorType || "(empty)"}`);
      }
      sensorTypes.add(sensorType);
    }
  }

  return { groupCount: groupKeys.size, sensorTypeCount: sensorTypes.size };
}

/* ------------------------------------------------------------------
 * 活动注册表（默认 = 构建内联的 JSON；server/licenseRegistry.ts 可在启动时用磁盘副本覆盖）
 * ------------------------------------------------------------------ */

let activeGroups: LicenseSensorGroup[] = bundledRegistry as LicenseSensorGroup[];
let groupsByKey = new Map<string, LicenseSensorGroup>();
let allRegistrySensorTypes: string[] = [];

function rebuildIndexes() {
  groupsByKey = new Map(activeGroups.map((group) => [group.key, group]));
  const seen = new Set<string>();
  const flat: string[] = [];
  for (const group of activeGroups) {
    for (const item of group.items) {
      if (!seen.has(item.value)) {
        seen.add(item.value);
        flat.push(item.value);
      }
    }
  }
  allRegistrySensorTypes = flat;
}

// 导入即校验：注册表坏了就让进程起不来，而不是静默签发错误密钥
validateLicenseSensorGroups(activeGroups);
rebuildIndexes();

/** 替换活动注册表（先校验，校验失败不会污染当前注册表） */
export function setLicenseSensorGroups(groups: unknown): { groupCount: number; sensorTypeCount: number } {
  const counts = validateLicenseSensorGroups(groups);
  activeGroups = groups as LicenseSensorGroup[];
  rebuildIndexes();
  return counts;
}

/** 当前活动的注册表（只读语义，请勿原地修改） */
export function getLicenseSensorGroups(): LicenseSensorGroup[] {
  return activeGroups;
}

/** 注册表里所有系统 key（按注册表顺序、已去重） */
export function getRegistrySensorTypes(): string[] {
  return allRegistrySensorTypes;
}

/** 注册表里所有分类 key */
export function getLicenseGroupKeys(): string[] {
  return activeGroups.map((group) => group.key);
}

/** 某个分类下的系统 key */
export function getGroupSensorTypes(groupKey: string): string[] {
  const group = groupsByKey.get(String(groupKey || "").trim());
  return group ? group.items.map((item) => item.value) : [];
}

/* ------------------------------------------------------------------
 * 分类令牌
 * ------------------------------------------------------------------ */

/** 生成分类令牌；分类不存在则 throw（禁止签发未知分类的密钥） */
export function createGroupScopeToken(groupKey: string): string {
  const normalized = String(groupKey || "").trim();
  if (!groupsByKey.has(normalized)) {
    throw new Error(`unknown license group: ${normalized || "(empty)"}`);
  }
  return `${GROUP_SCOPE_PREFIX}${normalized}`;
}

/** 只判前缀，不校验分类是否存在（用于展示层） */
export function isGroupScopeToken(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith(GROUP_SCOPE_PREFIX);
}

/**
 * 解析分类令牌。
 * @returns 非分类令牌返回 null；分类令牌但分类未知则 throw（不能降级当普通系统 key）
 */
export function parseGroupScopeToken(value: unknown): string | null {
  if (!isGroupScopeToken(value)) return null;
  const groupKey = String(value).trim().slice(GROUP_SCOPE_PREFIX.length).trim();
  if (!groupsByKey.has(groupKey)) {
    throw new Error(`unknown license group: ${groupKey || "(empty)"}`);
  }
  return groupKey;
}

/** 授权范围里是否含分类令牌（决定密钥 payload 的版本号 v2 / v3） */
export function containsGroupScopeToken(licenseFile: unknown): boolean {
  if (licenseFile === "all") return false;
  const entries = Array.isArray(licenseFile) ? licenseFile : [licenseFile];
  return entries.some((entry) => isGroupScopeToken(entry));
}

/* ------------------------------------------------------------------
 * 展开
 * ------------------------------------------------------------------ */

/**
 * 把密钥 payload 里的 `file` 展开为具体系统列表。
 *  - `"all"`                              → isAllTypes: true
 *  - `"humanBodyOptimized"`               → 单系统
 *  - `["hand0205", "humanBodyOptimized"]` → 固定数组（不随分类更新）
 *  - `"@group:precision"`                 → 分类当前全部成员（随注册表更新）
 *  - `["@group:care", "humanBodyOptimized"]` → 混合，按请求顺序展开并去重
 *
 * @param options.allSensorTypes "all" 时用于填充 sensorTypes 的全量清单
 * @throws 未知分类、或展开后为空
 */
export function expandLicenseFile(
  licenseFile: unknown,
  options: { allSensorTypes?: string[] } = {}
): ExpandedLicenseScope {
  if (licenseFile === "all") {
    return {
      isAllTypes: true,
      groupKeys: [],
      sensorTypes: Array.from(new Set((options.allSensorTypes ?? allRegistrySensorTypes).filter(Boolean))),
    };
  }

  const entries = Array.isArray(licenseFile) ? licenseFile : [licenseFile];
  const groupKeys: string[] = [];
  const sensorTypes: string[] = [];
  const seenGroups = new Set<string>();
  const seenTypes = new Set<string>();

  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const normalized = entry.trim();
    const groupKey = parseGroupScopeToken(normalized);
    if (groupKey) {
      if (!seenGroups.has(groupKey)) {
        seenGroups.add(groupKey);
        groupKeys.push(groupKey);
      }
      for (const item of groupsByKey.get(groupKey)!.items) {
        if (!seenTypes.has(item.value)) {
          seenTypes.add(item.value);
          sensorTypes.push(item.value);
        }
      }
      continue;
    }
    if (!seenTypes.has(normalized)) {
      seenTypes.add(normalized);
      sensorTypes.push(normalized);
    }
  }

  if (sensorTypes.length === 0) {
    throw new Error("license scope contains no display system");
  }

  return { isAllTypes: false, groupKeys, sensorTypes };
}

/** 授权范围入参（对应文档 §5.1 的请求格式） */
export type LicenseScopeInput =
  | { scopeType: "all" }
  | { scopeType: "group"; groupKey: string }
  | { scopeType: "groups"; groupKeys: string[] }
  | { scopeType: "systems"; sensorTypes: string[] }
  | { scopeType: "mixed"; groupKeys?: string[]; sensorTypes?: string[] };

/**
 * 由结构化入参构造密钥 payload 的 `file` 字段（文档 §5.2 buildLicenseFile）。
 * 单个条目降级成 string（与历史密钥格式一致），多个保持数组。
 */
export function buildLicenseFile(input: LicenseScopeInput): string | string[] {
  if (input.scopeType === "all") return "all";

  const tokens: string[] = [];
  if (input.scopeType === "group") {
    tokens.push(createGroupScopeToken(input.groupKey));
  } else if (input.scopeType === "groups") {
    for (const key of input.groupKeys || []) tokens.push(createGroupScopeToken(key));
  } else if (input.scopeType === "systems") {
    for (const value of input.sensorTypes || []) tokens.push(String(value).trim());
  } else {
    for (const key of input.groupKeys || []) tokens.push(createGroupScopeToken(key));
    for (const value of input.sensorTypes || []) tokens.push(String(value).trim());
  }

  return normalizeLicenseFile(tokens);
}

/**
 * 归一化授权范围：去空、去重、保持顺序；单条目降级为 string。
 * 会先 expandLicenseFile 校验一遍（未知分类 / 空范围直接 throw）。
 */
export function normalizeLicenseFile(scope: string | string[]): string | string[] {
  if (scope === "all") return "all";
  const entries = Array.isArray(scope) ? scope : [scope];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    const value = String(entry ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  expandLicenseFile(normalized);
  return normalized.length === 1 ? normalized[0] : normalized;
}

/* ------------------------------------------------------------------
 * 展示用元数据（doc §7：label / group 只用于页面展示）
 * ------------------------------------------------------------------ */

/**
 * 分类 key → 后台展示信息。
 * `dbGroupName` 必须与 sensorTypes.groupName 逐字一致 —— departments.sensorGroup
 * 就是按这个字符串绑定部门的，改了会让"按部门分组跨部门可见"失效。
 */
export const LICENSE_GROUP_META: Record<
  string,
  { dbGroupName: string; label: string; scopeLabel: string }
> = {
  common: { dbGroupName: "常用", label: "常用", scopeLabel: "常用全部" },
  care: { dbGroupName: "关怀", label: "关怀", scopeLabel: "关怀全部" },
  lab: { dbGroupName: "lab", label: "实验室", scopeLabel: "实验室全部" },
  custom: { dbGroupName: "定制", label: "定制", scopeLabel: "定制全部" },
  precision: { dbGroupName: "精密", label: "精密", scopeLabel: "精密全部" },
};

/** DB groupName → 分类 key（反查，用于部门可见性） */
export function groupKeyByDbGroupName(groupName: string): string | undefined {
  const target = String(groupName || "").trim();
  for (const [key, meta] of Object.entries(LICENSE_GROUP_META)) {
    if (meta.dbGroupName === target) return key;
  }
  return undefined;
}

/** 分类令牌 → 中文显示名，如 `@group:precision` → 精密全部 */
export function groupScopeLabel(token: string): string {
  const groupKey = String(token).trim().slice(GROUP_SCOPE_PREFIX.length).trim();
  return LICENSE_GROUP_META[groupKey]?.scopeLabel || `${groupKey}全部`;
}

/** 后台/客户端下拉用的分类清单 */
export function getLicenseGroupOptions() {
  return activeGroups.map((group) => {
    const meta = LICENSE_GROUP_META[group.key];
    return {
      key: group.key,
      token: `${GROUP_SCOPE_PREFIX}${group.key}`,
      label: meta?.label || group.key,
      scopeLabel: meta?.scopeLabel || `${group.key}全部`,
      dbGroupName: meta?.dbGroupName || group.key,
      icon: group.icon || "📦",
      sensorTypes: group.items.map((item) => item.value),
    };
  });
}

/**
 * 单个授权范围条目 → 中文显示名。
 *  - `"all"`                 → 全部传感器
 *  - `"@group:precision"`    → 精密全部
 *  - `"humanBodyOptimized"`  → 人体全身优化
 *
 * @param labelMap 优先使用的 value → label 映射（后台传 DB 里的传感器名，保证与传感器管理页一致）
 */
export function formatScopeEntry(entry: string, labelMap?: Record<string, string>): string {
  const value = String(entry ?? "").trim();
  if (!value) return "";
  if (value === "all") return "全部传感器";
  if (isGroupScopeToken(value)) return groupScopeLabel(value);
  return labelMap?.[value] || SENSOR_LABELS[value] || value;
}

/** 整个授权范围 → 中文显示串（如 "精密全部、人体全身优化"）。字符串入参按逗号拆分 */
export function formatLicenseScope(
  scope: string | string[] | null | undefined,
  labelMap?: Record<string, string>
): string {
  if (scope == null) return "";
  if (scope === "all") return "全部传感器";
  const entries = Array.isArray(scope) ? scope : String(scope).split(",");
  return entries
    .map((entry) => formatScopeEntry(entry, labelMap))
    .filter(Boolean)
    .join("、");
}

/**
 * 系统 key → 中文显示名。DB 只保存显示名，分类归属一律读注册表。
 * 新增系统时在这里补一行中文名即可（缺失则后台回退显示 value）。
 */
export const SENSOR_LABELS: Record<string, string> = {
  // common
  hand: "手部检测",
  // care
  jqbed: "小床监测",
  petCare: "宠物看护",
  petCareMini: "mini看护",
  // lab
  bed4096: "OneStep",
  bed4096num: "64*64高速",
  // custom
  smallBedNoAlg: "小床检测(数据)",
  smallBed12B: "小床检测(12B)",
  matCol: "小床褥采集",
  tempFullBed: "温度全床系统",
  wholeChair: "整椅展示",
  minzhen: "轮椅",
  // precision
  handSinglePoint: "32*32(检测点)",
  hand0205: "触觉手套",
  hand0205Double: "触觉手套2",
  handGlove115200: "触觉手套(115200)",
  handGloveFullPacket: "触觉手套(整包)",
  smallSample: "10*10小样",
  robot1: "宇树G1触觉上衣",
  robotSY: "松延N2触觉上衣",
  robotLCF: "零次方H1触觉上衣",
  footVideo: "触觉足底",
  daliegu: "14x20高速",
  fast256: "16x16高速",
  fast1024: "32x32高速",
  humanBody: "人体全身",
  humanBodyOptimized: "人体全身优化",
  // 注册表外的本地附加项
  normal: "正常测试",
};
