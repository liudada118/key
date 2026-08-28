/**
 * 把 config/licenseSensorGroups.json 同步进 shared/crypto-lib.cjs 的内联快照。
 *
 *   pnpm registry:snapshot          # 重新生成快照
 *   pnpm registry:snapshot --check  # 只检查是否已同步（不写文件），有漂移则退出码 1
 *
 * 背景：config/licenseSensorGroups.json 是分类与系统归属的唯一数据源，由桌面端
 * （E:\shroom1）的 scripts/sync-license-registry.cjs 同步过来。服务端自身直接静态
 * import 这份 JSON，所以改完就生效；但 shared/crypto-lib.cjs 是要发给 Electron
 * 集成方的**自包含**副本，内联了一份快照，必须手工跟着改 —— 这个脚本就是替代那次手工。
 *
 * 顺带做两件容易漏的事：
 *  1. 把注册表文件规范成 LF。Windows 上 core.autocrlf=true 会让工作副本变成 CRLF，
 *     而 server/licenseRegistry.ts 是对原始字节算 SHA-256 的，于是本地和 Linux
 *     生产环境算出来的哈希不一样，DEPLOY.md §3.4 的两端对哈希就永远对不上。
 *  2. 检查 shared/licenseScopes.ts 的 SENSOR_LABELS 是否覆盖了注册表里的每个系统。
 *     缺了不会报错，但后台各处会把裸 key（如 newSystem）当中文名显示出来。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import {
  SENSOR_LABELS,
  validateLicenseSensorGroups,
  type LicenseSensorGroup,
} from "../shared/licenseScopes";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const REGISTRY_PATH = path.join(
  REPO_ROOT,
  "config",
  "licenseSensorGroups.json",
);
const CRYPTO_LIB_PATH = path.join(REPO_ROOT, "shared", "crypto-lib.cjs");

const BEGIN_MARKER =
  "/* --- BEGIN GENERATED REGISTRY SNAPSHOT --- 请勿手改，用 pnpm registry:snapshot 重新生成 */";
const END_MARKER = "/* --- END GENERATED REGISTRY SNAPSHOT --- */";

/** 注册表之外的本地附加项：这些 key 允许出现在 SENSOR_LABELS 里而不属于任何分类 */
const KNOWN_LOCAL_EXTRAS = new Set(["normal"]);

const checkOnly = process.argv.includes("--check");
const allowMissingLabels = process.argv.includes("--allow-missing-labels");

const problems: string[] = [];
const notes: string[] = [];

function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 1. 读取注册表，规范成 LF，算 SHA-256
 * ------------------------------------------------------------------ */

if (!fs.existsSync(REGISTRY_PATH)) {
  fail(
    `注册表不存在：${REGISTRY_PATH}\n  先在桌面端执行 node scripts/sync-license-registry.cjs "${REGISTRY_PATH}"`,
  );
}

const rawOnDisk = fs.readFileSync(REGISTRY_PATH, "utf8");
const registryContent = rawOnDisk.replace(/\r\n/g, "\n");

if (registryContent !== rawOnDisk) {
  if (checkOnly) {
    problems.push(
      `config/licenseSensorGroups.json 是 CRLF 换行，本地算出的 SHA-256 会与 Linux 生产环境不一致（运行 pnpm registry:snapshot 修正）`,
    );
  } else {
    fs.writeFileSync(REGISTRY_PATH, registryContent, "utf8");
    notes.push(
      "已把 config/licenseSensorGroups.json 的换行规范成 LF（git blob 本来就是 LF，此改动无 diff）",
    );
  }
}

let registry: LicenseSensorGroup[];
try {
  registry = JSON.parse(registryContent) as LicenseSensorGroup[];
} catch (error) {
  fail(`注册表不是合法 JSON：${REGISTRY_PATH}\n  ${(error as Error).message}`);
}

// 与服务端启动时同一套校验规则：重复分类 key / 重复系统 value / 空分类一律致命
let counts: { groupCount: number; sensorTypeCount: number };
try {
  counts = validateLicenseSensorGroups(registry);
} catch (error) {
  fail(
    `注册表校验失败（服务端启动时也会因此拒绝启动）：${(error as Error).message}`,
  );
}

const sha256 = crypto
  .createHash("sha256")
  .update(registryContent)
  .digest("hex");

/* ------------------------------------------------------------------ *
 * 2. 检查 SENSOR_LABELS 覆盖率
 * ------------------------------------------------------------------ */

const registryValues = registry.flatMap((group) =>
  group.items.map((item) => item.value),
);
const missingLabels = registryValues.filter((value) => !SENSOR_LABELS[value]);
const staleLabels = Object.keys(SENSOR_LABELS).filter(
  (value) => !registryValues.includes(value) && !KNOWN_LOCAL_EXTRAS.has(value),
);

if (missingLabels.length > 0) {
  const lines = missingLabels.map((value) => `  ${value}: "……",`).join("\n");
  const message =
    `shared/licenseScopes.ts 的 SENSOR_LABELS 缺少 ${missingLabels.length} 个系统的中文名：\n` +
    `${lines}\n  缺了不会报错，但后台密钥列表、生成页、飞书卡片都会显示成裸 key。` +
    (allowMissingLabels ? "" : "\n  确认要先跳过就加 --allow-missing-labels。");
  if (allowMissingLabels) notes.push(message);
  else problems.push(message);
}

if (staleLabels.length > 0) {
  notes.push(
    `SENSOR_LABELS 里有 ${staleLabels.length} 个已不在注册表中的 key（历史遗留，仅提示）：${staleLabels.join("、")}`,
  );
}

/* ------------------------------------------------------------------ *
 * 3. 生成快照并写回 shared/crypto-lib.cjs
 * ------------------------------------------------------------------ */

const q = (value: string) => JSON.stringify(value);

const literal =
  `const BUNDLED_LICENSE_SENSOR_GROUPS = [\n` +
  registry
    .map((group) => {
      const items = group.items
        .map((item) => `{ value: ${q(item.value)} }`)
        .join(", ");
      return `{ key: ${q(group.key)}, icon: ${q(group.icon || "📦")}, items: [${items}] },`;
    })
    .join("\n") +
  `\n];\n`;

// 交给 prettier 排版，保证产出与 pnpm format 的结果一致（仓库无 .prettierrc，用默认 printWidth 80）
const formattedLiteral = await prettier.format(literal, {
  ...(await prettier.resolveConfig(CRYPTO_LIB_PATH)),
  parser: "babel",
});

const snapshotBlock =
  `${BEGIN_MARKER}\n` +
  `/** 内联注册表快照（sha256=${sha256}） */\n` +
  formattedLiteral.trimEnd() +
  `\n${END_MARKER}`;

// 统一按 LF 比对与拼接，否则 Windows 上（CRLF 工作副本）会把 --check 判成永远漂移；
// 写回时再还原成该文件原本的换行风格，避免留下混合换行的文件。
const rawCryptoLib = fs.readFileSync(CRYPTO_LIB_PATH, "utf8");
const cryptoLibUsesCrlf = rawCryptoLib.includes("\r\n");
const cryptoLibSource = rawCryptoLib.replace(/\r\n/g, "\n");
const beginIndex = cryptoLibSource.indexOf(BEGIN_MARKER);
const endIndex = cryptoLibSource.indexOf(END_MARKER);

if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
  fail(
    `shared/crypto-lib.cjs 里找不到成对的生成标记。\n` +
      `  应当存在这两行包住 BUNDLED_LICENSE_SENSOR_GROUPS：\n` +
      `    ${BEGIN_MARKER}\n    ${END_MARKER}`,
  );
}

const currentBlock = cryptoLibSource.slice(
  beginIndex,
  endIndex + END_MARKER.length,
);
const snapshotInSync = currentBlock === snapshotBlock;

if (checkOnly) {
  if (!snapshotInSync) {
    problems.push(
      "shared/crypto-lib.cjs 的内联快照与 config/licenseSensorGroups.json 不一致（运行 pnpm registry:snapshot 同步）",
    );
  }
} else if (!snapshotInSync) {
  const next =
    cryptoLibSource.slice(0, beginIndex) +
    snapshotBlock +
    cryptoLibSource.slice(endIndex + END_MARKER.length);
  fs.writeFileSync(
    CRYPTO_LIB_PATH,
    cryptoLibUsesCrlf ? next.replace(/\n/g, "\r\n") : next,
    "utf8",
  );
  notes.push("已更新 shared/crypto-lib.cjs 的内联快照与 sha256 注释");
} else {
  notes.push("shared/crypto-lib.cjs 的内联快照已是最新，无需改动");
}

/* ------------------------------------------------------------------ *
 * 4. 汇报
 * ------------------------------------------------------------------ */

process.stdout.write(
  `\n注册表：${path.relative(REPO_ROOT, REGISTRY_PATH)}\n` +
    `  ${counts.groupCount} 个分类 / ${counts.sensorTypeCount} 个系统\n` +
    `  sha256=${sha256}\n` +
    `  分类：${registry.map((group) => group.key).join("、")}\n`,
);

for (const note of notes) process.stdout.write(`\n· ${note}\n`);

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`\n✗ ${problem}\n`);
  process.stderr.write(
    `\n${checkOnly ? "注册表快照检查未通过。" : "存在需要人工处理的问题。"}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  checkOnly
    ? `\n✓ 注册表快照检查通过。\n`
    : `\n✓ 同步完成。接着跑 pnpm check && pnpm test（cryptoLibParity.test.ts 会复核一致性）。\n`,
);
