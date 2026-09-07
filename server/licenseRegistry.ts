/**
 * 授权分类注册表的运行时加载器（Node 侧，只在服务启动时跑一次）。
 *
 * 加载顺序：
 *   1. 构建内联的 config/licenseSensorGroups.json（shared/licenseScopes.ts 静态 import）
 *   2. 若磁盘上存在 config/licenseSensorGroups.json（或 LICENSE_REGISTRY_PATH 指定的文件）→ 覆盖
 *
 * 这样同步注册表后只要重启服务即可生效，不必重新 build；同时打包产物自带一份兜底。
 * 磁盘文件存在但无效时**必须 fail-fast**，不能退回空列表继续签发（文档 §11）。
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  getLicenseGroupKeys,
  getLicenseSensorGroups,
  getRegistrySensorTypes,
  setLicenseSensorGroups,
} from "../shared/licenseScopes";

export const DEFAULT_REGISTRY_RELATIVE_PATH = path.join("config", "licenseSensorGroups.json");

let registrySha256: string | null = null;
let registrySource = "bundled";

/** 注册表内容的 SHA-256（与桌面端 sync-license-registry.cjs 的输出对比用） */
export function getLicenseRegistrySha256(): string {
  if (registrySha256) return registrySha256;
  // 内联兜底：按同步脚本一致的序列化方式（2 空格缩进 + 结尾换行）计算
  const content = `${JSON.stringify(getLicenseSensorGroups(), null, 2)}\n`;
  registrySha256 = crypto.createHash("sha256").update(content).digest("hex");
  return registrySha256;
}

export function getLicenseRegistryInfo() {
  return {
    source: registrySource,
    sha256: getLicenseRegistrySha256(),
    groupCount: getLicenseGroupKeys().length,
    sensorTypeCount: getRegistrySensorTypes().length,
    groupKeys: getLicenseGroupKeys(),
  };
}

function resolveRegistryPath(): string {
  const fromEnv = process.env.LICENSE_REGISTRY_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), DEFAULT_REGISTRY_RELATIVE_PATH);
}

/**
 * 加载并校验注册表。
 * @throws 磁盘上的注册表存在但无法解析/校验失败 —— 调用方不要 catch，让进程起不来
 */
export function loadLicenseRegistry(): ReturnType<typeof getLicenseRegistryInfo> {
  const registryPath = resolveRegistryPath();

  if (!fs.existsSync(registryPath)) {
    // 内联兜底（shared/licenseScopes.ts 导入时已校验过）
    console.warn(
      `[License] 磁盘注册表不存在，使用构建内联副本：${registryPath}`
    );
    registrySource = "bundled";
    registrySha256 = null;
    const info = getLicenseRegistryInfo();
    console.log(
      `[License] 注册表已加载（${info.source}）：${info.groupCount} 个分类 / ${info.sensorTypeCount} 个系统，sha256=${info.sha256}`
    );
    return info;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(registryPath, "utf-8");
  } catch (error) {
    throw new Error(
      `license registry is unreadable: ${registryPath} (${(error as Error).message})`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `license registry is not valid JSON: ${registryPath} (${(error as Error).message})`
    );
  }

  // 校验失败会 throw，且不会污染当前活动注册表
  setLicenseSensorGroups(parsed);
  registrySource = registryPath;
  registrySha256 = crypto.createHash("sha256").update(raw).digest("hex");

  const info = getLicenseRegistryInfo();
  console.log(
    `[License] 注册表已加载（${info.source}）：${info.groupCount} 个分类 / ${info.sensorTypeCount} 个系统，sha256=${info.sha256}`
  );
  console.log(`[License] 分类：${info.groupKeys.join("、")}`);
  return info;
}
