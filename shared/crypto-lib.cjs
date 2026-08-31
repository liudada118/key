/**
 * AES-ECB 加密/解密模块 (CommonJS 版本)
 *
 * 用于 Electron 项目中通过 require() 引入
 * 使用方法: const { generateLicenseKey, decodeLicenseKey, aesEncrypt, aesDecrypt } = require('./crypto-lib.cjs');
 *
 * 依赖: npm install crypto-js
 *
 * 算法与桌面端 shroom1.0 (aesUtil.js / aes_ecb.js) 完全一致：
 *   AES / ECB / Pkcs7，密钥 = "JIANXINGZHEPSVMC" 逐字符转 hex 后 Hex.parse（AES-128）。
 *   输出纯 hex 密文（无 IV、无认证标签）——与桌面端互通、老 ECB 密钥可继续解。
 * 支持多选传感器类型（数组）、"all" 全选，以及 v3 分类授权令牌 `@group:<groupKey>`。
 *
 * v3 分类授权：密钥里保存 `@group:precision` 这种稳定令牌，解密时才按注册表展开成具体系统。
 *   往分类里加系统后，未过期的旧分类密钥能自动获得新增系统 —— 前提是本文件用的注册表也更新了。
 *   注册表加载顺序：同目录 licenseSensorGroups.json > 内联快照；也可调用
 *   setLicenseSensorGroups(groups) 由集成方注入。
 */
const CryptoJS = require("crypto-js");

const KEY_STR = "JIANXINGZHEPSVMC";

function deriveKey() {
  let hex = "";
  for (let i = 0; i < KEY_STR.length; i++) {
    hex += KEY_STR.charCodeAt(i).toString(16);
  }
  return CryptoJS.enc.Hex.parse(hex);
}

function aesEncrypt(plaintext) {
  const key = deriveKey();
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.ciphertext.toString();
}

function aesDecrypt(hexStr) {
  try {
    if (!hexStr) return null;
    const key = deriveKey();
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.format.Hex.parse(hexStr),
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    return result || null;
  } catch (e) {
    return null;
  }
}

/**
 * 传感器类型分组定义
 * 与 Shroom1.0 (1.0分支) License.jsx 完全一致
 */
const SENSOR_GROUPS = [
  {
    group: "触觉手套",
    icon: "🧤",
    items: [
      { label: "触觉手套", value: "hand0205" },
      { label: "手套模型", value: "hand0507" },
      { label: "手套96", value: "gloves" },
      { label: "左手手套", value: "gloves1" },
      { label: "右手手套", value: "gloves2" },
      { label: "手套触觉", value: "hand0205Point" },
      { label: "手套触觉147", value: "hand0205Point147" },
      { label: "手部检测", value: "newHand" },
    ],
  },
  {
    group: "机器人触觉",
    icon: "🤖",
    items: [
      { label: "宇树G1触觉上衣", value: "robot1" },
      { label: "松延N2触觉上衣", value: "robotSY" },
      { label: "零次方H1触觉上衣", value: "robotLCF" },
      { label: "机器人", value: "robot0428" },
      { label: "机器人出手", value: "robot" },
    ],
  },
  {
    group: "足底检测",
    icon: "🦶",
    items: [
      { label: "触觉足底", value: "footVideo" },
      { label: "脚型检测", value: "foot" },
      { label: "256鞋垫", value: "footVideo256" },
    ],
  },
  {
    group: "高速矩阵",
    icon: "⚡",
    items: [
      { label: "16×16高速", value: "fast256" },
      { label: "32×32高速", value: "fast1024" },
      { label: "1024高速座椅", value: "fast1024sit" },
      { label: "14×20高速", value: "daliegu" },
      { label: "小型样品", value: "smallSample" },
    ],
  },
  {
    group: "汽车座椅",
    icon: "🚗",
    items: [
      { label: "汽车座椅", value: "car" },
      { label: "汽车靠背(量产)", value: "car10" },
      { label: "沃尔沃", value: "volvo" },
      { label: "清闲椅子", value: "carQX" },
      { label: "轮椅", value: "yanfeng10" },
      { label: "沙发", value: "sofa" },
      { label: "car100", value: "car100" },
      { label: "车载传感器", value: "carCol" },
    ],
  },
  {
    group: "床垫监测",
    icon: "🛏️",
    items: [
      { label: "床垫监测", value: "bigBed" },
      { label: "小床监测", value: "jqbed" },
      { label: "席悦1.0", value: "smallBed" },
      { label: "席悦2.0", value: "xiyueReal1" },
      { label: "小床128", value: "smallBed1" },
      { label: "4096", value: "bed4096" },
      { label: "4096数字", value: "bed4096num" },
      { label: "256", value: "bed1616" },
    ],
  },
  {
    group: "其他",
    icon: "📦",
    items: [
      { label: "眼罩", value: "eye" },
      { label: "席悦座椅", value: "sit10" },
      { label: "小矩阵1", value: "smallM" },
      { label: "矩阵2", value: "rect" },
      { label: "T-short", value: "short" },
      { label: "唐群座椅", value: "CarTq" },
      { label: "正常测试", value: "normal" },
      { label: "清闲", value: "ware" },
      { label: "清闲椅", value: "chairQX" },
      { label: "3D数字", value: "Num3D" },
      { label: "本地自适应", value: "localCar" },
      { label: "手部视频", value: "handVideo" },
      { label: "手部视频1", value: "handVideo1" },
      { label: "手部检测(蓝)", value: "handBlue" },
      { label: "座椅采集", value: "sitCol" },
      { label: "小床褥采集", value: "matCol" },
      { label: "小床睡姿采集", value: "matColPos" },
    ],
  },
];

/** 所有传感器平铺列表 */
const ALL_SENSORS = SENSOR_GROUPS.flatMap((g) => g.items);

/** 传感器 value → label 映射 */
const SENSOR_LABEL_MAP = {};
ALL_SENSORS.forEach((s) => { SENSOR_LABEL_MAP[s.value] = s.label; });

/* ============================================================
 * v3 分类授权注册表
 *
 * 分类与系统归属的唯一数据源是桌面端的 licenseSensorGroups.json。
 * 本文件要发给 Electron 集成方，必须自包含，所以内联一份快照；
 * 加载顺序：同目录 licenseSensorGroups.json（若存在）> 内联快照，
 * 也可由集成方调用 setLicenseSensorGroups(groups) 注入。
 *
 * 注意：分类密钥保存的是稳定令牌 `@group:<groupKey>`，展开发生在解密时 ——
 * 所以本文件用的注册表落后于服务端时，旧分类密钥拿不到新增系统。升级客户端时记得一起同步。
 * ============================================================ */

/** 分类令牌前缀，与服务端 shared/licenseScopes.ts 保持一致 */
const GROUP_SCOPE_PREFIX = "@group:";

/* --- BEGIN GENERATED REGISTRY SNAPSHOT --- 请勿手改，用 pnpm registry:snapshot 重新生成 */
/** 内联注册表快照（sha256=c1694700ac56992310da0f642a2feb74e0119813d24b6f95e279c3561d8411f0） */
const BUNDLED_LICENSE_SENSOR_GROUPS = [
  { key: "common", icon: "⭐", items: [{ value: "hand" }] },
  {
    key: "care",
    icon: "❤️",
    items: [{ value: "jqbed" }, { value: "petCare" }, { value: "petCareMini" }],
  },
  {
    key: "lab",
    icon: "🧪",
    items: [{ value: "bed4096" }, { value: "bed4096num" }],
  },
  {
    key: "custom",
    icon: "⚙️",
    items: [
      { value: "smallBedNoAlg" },
      { value: "smallBed12B" },
      { value: "matCol" },
      { value: "tempFullBed" },
      { value: "wholeChair" },
      { value: "minzhen" },
    ],
  },
  {
    key: "precision",
    icon: "🔬",
    items: [
      { value: "handSinglePoint" },
      { value: "hand0205" },
      { value: "hand0205Double" },
      { value: "handGlove115200" },
      { value: "handGloveFullPacket" },
      { value: "smallSample" },
      { value: "robot1" },
      { value: "robotSY" },
      { value: "robotLCF" },
      { value: "footVideo" },
      { value: "daliegu" },
      { value: "fast256" },
      { value: "fast1024" },
      { value: "humanBodyOptimized" },
    ],
  },
];
/* --- END GENERATED REGISTRY SNAPSHOT --- */

/**
 * 校验注册表结构：分类为空 / 分类 key 重复或非法 / 分类无系统 / 系统 value 全局重复 全部 throw。
 * @param {any} groups
 * @returns {{groupCount:number, sensorTypeCount:number}}
 */
function validateLicenseSensorGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("license sensor groups must be a non-empty array");
  }
  const groupKeys = {};
  const sensorTypes = {};
  var groupCount = 0;
  var sensorTypeCount = 0;
  for (var i = 0; i < groups.length; i++) {
    const group = groups[i] || {};
    const groupKey = typeof group.key === "string" ? group.key.trim() : "";
    if (!groupKey || groupKeys[groupKey]) {
      throw new Error("duplicate or invalid license group: " + (groupKey || "(empty)"));
    }
    if (!Array.isArray(group.items) || group.items.length === 0) {
      throw new Error("license group has no display systems: " + groupKey);
    }
    groupKeys[groupKey] = true;
    groupCount++;
    for (var j = 0; j < group.items.length; j++) {
      const item = group.items[j] || {};
      const value = typeof item.value === "string" ? item.value.trim() : "";
      if (!value || sensorTypes[value]) {
        throw new Error("duplicate or invalid display system: " + (value || "(empty)"));
      }
      sensorTypes[value] = true;
      sensorTypeCount++;
    }
  }
  return { groupCount: groupCount, sensorTypeCount: sensorTypeCount };
}

var activeLicenseGroups = BUNDLED_LICENSE_SENSOR_GROUPS;
var licenseGroupsByKey = {};
var registrySensorTypes = [];

function rebuildLicenseGroupIndexes() {
  licenseGroupsByKey = {};
  registrySensorTypes = [];
  for (var i = 0; i < activeLicenseGroups.length; i++) {
    const group = activeLicenseGroups[i];
    licenseGroupsByKey[group.key] = group;
    for (var j = 0; j < group.items.length; j++) {
      const value = group.items[j].value;
      if (registrySensorTypes.indexOf(value) === -1) registrySensorTypes.push(value);
    }
  }
}

/** 替换活动注册表（先校验；校验失败不会污染当前注册表） */
function setLicenseSensorGroups(groups) {
  const counts = validateLicenseSensorGroups(groups);
  activeLicenseGroups = groups;
  rebuildLicenseGroupIndexes();
  return counts;
}

setLicenseSensorGroups(BUNDLED_LICENSE_SENSOR_GROUPS);

// 同目录 licenseSensorGroups.json 优先：集成方同步一份 JSON 过来即可，不必改本文件。
// 文件不存在 / require 失败 → 静默沿用内联快照；文件存在但内容非法 → 让异常抛出去（fail-fast）。
(function loadSiblingRegistry() {
  var sibling;
  try {
    sibling = require("./licenseSensorGroups.json");
  } catch (e) {
    return;
  }
  setLicenseSensorGroups(sibling);
})();

/** 当前活动注册表 */
function getLicenseSensorGroups() {
  return activeLicenseGroups;
}

/** 注册表里所有系统 key（按注册表顺序、已去重） */
function getRegistrySensorTypes() {
  return registrySensorTypes;
}

/** 注册表里所有分类 key */
function getLicenseGroupKeys() {
  return activeLicenseGroups.map(function (g) { return g.key; });
}

/** 某个分类下的系统 key */
function getGroupSensorTypes(groupKey) {
  const group = licenseGroupsByKey[String(groupKey || "").trim()];
  return group ? group.items.map(function (item) { return item.value; }) : [];
}

/** 生成分类令牌；分类不存在则 throw（禁止签发未知分类的密钥） */
function createGroupScopeToken(groupKey) {
  const normalized = String(groupKey || "").trim();
  if (!licenseGroupsByKey[normalized]) {
    throw new Error("unknown license group: " + (normalized || "(empty)"));
  }
  return GROUP_SCOPE_PREFIX + normalized;
}

/** 只判前缀，不校验分类是否存在（用于展示层） */
function isGroupScopeToken(value) {
  return typeof value === "string" && value.trim().indexOf(GROUP_SCOPE_PREFIX) === 0;
}

/**
 * 解析分类令牌。非分类令牌返回 null；
 * 是分类令牌但分类未知则 throw —— 不能降级当普通系统 key，否则等于凭空放行。
 */
function parseGroupScopeToken(value) {
  if (!isGroupScopeToken(value)) return null;
  const groupKey = String(value).trim().slice(GROUP_SCOPE_PREFIX.length).trim();
  if (!licenseGroupsByKey[groupKey]) {
    throw new Error("unknown license group: " + (groupKey || "(empty)"));
  }
  return groupKey;
}

/** 授权范围里是否含分类令牌（决定密钥 payload 的版本号 v2 / v3） */
function containsGroupScopeToken(licenseFile) {
  if (licenseFile === "all") return false;
  const entries = Array.isArray(licenseFile) ? licenseFile : [licenseFile];
  return entries.some(function (entry) { return isGroupScopeToken(entry); });
}

/** "all" 展开出的系统清单 = 注册表全部 ∪ 历史 ALL_SENSORS（只增不减） */
function allAuthorizedSensorTypes() {
  const out = registrySensorTypes.slice();
  for (var i = 0; i < ALL_SENSORS.length; i++) {
    if (out.indexOf(ALL_SENSORS[i].value) === -1) out.push(ALL_SENSORS[i].value);
  }
  return out;
}

/**
 * 把密钥 payload 里的 file 展开成具体系统列表。
 *  - "all"                                  → isAllTypes: true
 *  - "humanBodyOptimized"                   → 单系统
 *  - ["hand0205","humanBodyOptimized"]      → 固定数组（不随分类更新）
 *  - "@group:precision"                     → 分类当前全部成员（随注册表更新）
 *  - ["@group:care","humanBodyOptimized"]   → 混合，按顺序展开并去重
 * @throws 未知分类、或展开后为空
 */
function expandLicenseFile(licenseFile) {
  if (licenseFile === "all") {
    return { isAllTypes: true, groupKeys: [], sensorTypes: allAuthorizedSensorTypes() };
  }
  const entries = Array.isArray(licenseFile) ? licenseFile : [licenseFile];
  const groupKeys = [];
  const sensorTypes = [];
  for (var i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (typeof entry !== "string" || !entry.trim()) continue;
    const normalized = entry.trim();
    const groupKey = parseGroupScopeToken(normalized);
    if (groupKey) {
      if (groupKeys.indexOf(groupKey) === -1) groupKeys.push(groupKey);
      const items = licenseGroupsByKey[groupKey].items;
      for (var j = 0; j < items.length; j++) {
        if (sensorTypes.indexOf(items[j].value) === -1) sensorTypes.push(items[j].value);
      }
      continue;
    }
    if (sensorTypes.indexOf(normalized) === -1) sensorTypes.push(normalized);
  }
  if (sensorTypes.length === 0) {
    throw new Error("license scope contains no display system");
  }
  return { isAllTypes: false, groupKeys: groupKeys, sensorTypes: sensorTypes };
}

/** 归一化授权范围：去空、去重、保持顺序；单条目降级为 string。会先展开校验一遍 */
function normalizeLicenseFile(scope) {
  if (scope === "all") return "all";
  const entries = Array.isArray(scope) ? scope : [scope];
  const normalized = [];
  for (var i = 0; i < entries.length; i++) {
    const value = String(entries[i] == null ? "" : entries[i]).trim();
    if (!value || normalized.indexOf(value) !== -1) continue;
    normalized.push(value);
  }
  expandLicenseFile(normalized);
  return normalized.length === 1 ? normalized[0] : normalized;
}

/**
 * 生成密钥
 * @param {string|string[]} sensorTypes - "all" / 单个系统 key / 数组；数组元素可以是 `@group:<groupKey>` 分类令牌
 * @param {number} days - 有效期天数
 * @param {string} category - 密钥类型: "production"(量产) / "rental"(在线租赁)
 * @returns {string} hex 格式密钥字符串
 * @throws 分类不存在、或授权范围为空
 */
function generateLicenseKey(sensorTypes, days, category) {
  category = category || "production";
  const expireTimestamp = Date.now() + days * 24 * 60 * 60 * 1000;

  // 分类令牌原样保存 —— 禁止在此展开成系统数组，否则密钥就固化成签发当时的成员，
  // 失去"随分类更新"的意义。normalizeLicenseFile 内部会校验未知分类 / 空范围。
  const file = normalizeLicenseFile(sensorTypes);

  const payload = JSON.stringify({
    date: expireTimestamp,
    file: file,
    cat: category,
    // 含分类令牌 → v3；老的单系统 / 固定数组 / all → 保持 v2
    v: containsGroupScopeToken(file) ? 3 : 2,
    // 随机 nonce：ECB 确定性加密，加随机字段保证每把密钥串唯一（解密端自动忽略）
    n: CryptoJS.lib.WordArray.random(8).toString(),
  });
  return aesEncrypt(payload);
}

/**
 * 解密密钥，返回解析后的信息
 * @param {string} hexKey - hex 格式密钥字符串
 * @param {number} [nowMs] - 可选，判过期所用的"当前时间"(ms)。
 *        在线版传服务器时间、离线版传防回拨锚点时间；不传则用本机 Date.now()。
 * @returns {Object} 解析结果
 */
function decodeLicenseKey(hexKey, nowMs) {
  try {
    const plaintext = aesDecrypt(hexKey.trim());
    if (!plaintext) {
      return { valid: false, error: "解密失败：无效的密钥或密钥已被篡改" };
    }
    const parsed = JSON.parse(plaintext);
    if (!parsed.date || !parsed.file) {
      return { valid: false, error: "解密失败：缺少必要字段" };
    }
    const expireTimestamp = parseFloat(parsed.date);
    const now = (typeof nowMs === "number" && !isNaN(nowMs)) ? nowMs : Date.now();
    const remainingMs = expireTimestamp - now;
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    const expireDate = new Date(expireTimestamp).toISOString();

    // 分类令牌按当前注册表展开；未知分类一律判无效，不能降级当普通系统 key
    var expanded;
    try {
      expanded = expandLicenseFile(parsed.file);
    } catch (e) {
      return {
        valid: false,
        error: "授权范围无效：" + (e && e.message),
        expireTimestamp: expireTimestamp,
        expireDate: expireDate,
        remainingDays: remainingDays,
        scope: parsed.file,
        category: parsed.cat || "production",
        version: parsed.v || 1,
      };
    }

    // sensorType 保持历史语义（逗号拼接的原始范围）
    const sensorType = expanded.isAllTypes
      ? "all"
      : Array.isArray(parsed.file) ? parsed.file.join(",") : String(parsed.file);

    return {
      valid: remainingDays > 0,
      expireTimestamp: expireTimestamp,
      sensorType: sensorType,
      sensorTypes: expanded.sensorTypes,
      isAllTypes: expanded.isAllTypes,
      groupKeys: expanded.groupKeys,
      scope: parsed.file,
      category: parsed.cat || "production",
      expireDate: expireDate,
      remainingDays: remainingDays,
      version: parsed.v || 1,
    };
  } catch (e) {
    return { valid: false, error: "解密失败：密钥格式错误" };
  }
}

/* ============================================================
 * 离线版（纯离线）支持：RSA 验签 + 防回拨时间锚点
 * 仅在 Node/Electron 环境可用（依赖内置 crypto / fs 模块）。
 * 离线版不联网，靠以下三关：RSA 验签(防伪造) + 时间锚点(防调时间) + 本机时间判过期。
 * ============================================================ */

/**
 * 离线激活码的 RSA 公钥（PEM）。
 * 这是密钥管理系统的预置公钥（ensureRsaKeyPair 强制使用，稳定不变）。
 * 若日后在管理系统里更换/轮换了 RSA 密钥对，请同步更新这里；
 * 也可在调用 verifyOfflineLicense 时用 options.publicKey 传入覆盖。
 */
const OFFLINE_PUBLIC_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0xly+Gg/8LvoWV0VRO/k",
  "l1dEQRt7N6yilC2yiza+W1V2aXWKoiLlkPcJa9KQmNArjcHq8nBLlEppHjwEm2u5",
  "SrgADP/frf1n8GZpRejZo6Ab1psppUm/neVcoxsK+0z6a00B9syv8AEIt2jrN4ZZ",
  "zz51MgJqzgXmqPaibtzGl8RFr1jYJ2JpXNes6BqFpjQng1S8hu4VgWBIljkE3jKF",
  "fHwTP9KPtEcoH/uSPmW5X7IuwpDW2QO6sO61uv/luLI4Wx4upX4CIUepwIzDyG6B",
  "fYx2AAZJ1oNEBW28wIUf7i5sVT0FsWRsR55Q3KUcsiqAUVduKiKTQN3dnmbyC1Fg",
  "AQIDAQAB",
  "-----END PUBLIC KEY-----",
].join("\n");

/**
 * 验证离线激活码（RSA-SHA256 验签 + 判过期）。已去掉机器码绑定。
 * @param {string} activationCode - base64 激活码（{payload, signature} 的 base64）
 * @param {Object} [options]
 * @param {string} [options.publicKey] - 覆盖默认公钥（PEM）
 * @param {number} [options.nowMs] - 判过期所用时间(ms)，建议传 getTrustedNow() 的防回拨时间；不传用本机 Date.now()
 * @returns {{valid:boolean, expireTimestamp?:number, sensorType?:string, sensorTypes?:string[], isAllTypes?:boolean, remainingDays?:number, version?:number, error?:string}}
 */
function verifyOfflineLicense(activationCode, options) {
  options = options || {};
  try {
    const crypto = require("crypto");
    const publicKey = options.publicKey || OFFLINE_PUBLIC_KEY;

    if (!activationCode) return { valid: false, error: "激活码为空" };

    // 1) 解开外层 { payload, signature }
    let envelope;
    try {
      envelope = JSON.parse(Buffer.from(activationCode.trim(), "base64").toString("utf-8"));
    } catch (e) {
      return { valid: false, error: "激活码格式错误" };
    }
    if (!envelope || !envelope.payload || !envelope.signature) {
      return { valid: false, error: "激活码缺少 payload 或 signature" };
    }

    // 2) RSA-SHA256 验签（对 payload 的 base64 串验签）
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(envelope.payload);
    verify.end();
    const sigOk = verify.verify(publicKey, envelope.signature, "base64");
    if (!sigOk) return { valid: false, error: "签名校验失败：激活码无效或被篡改" };

    // 3) 解析 payload
    const payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf-8"));
    const expireTimestamp = parseFloat(payload.expireDate);
    if (!expireTimestamp) return { valid: false, error: "激活码缺少到期时间" };

    // 4) 判过期（用传入时间或本机时间）
    const now = (typeof options.nowMs === "number" && !isNaN(options.nowMs)) ? options.nowMs : Date.now();
    const remainingDays = Math.ceil((expireTimestamp - now) / (24 * 60 * 60 * 1000));

    // 解析传感器类型：与在线密钥同一套展开逻辑，未知分类判无效
    const f = payload.sensorTypes;
    var expanded;
    try {
      expanded = expandLicenseFile(f);
    } catch (e) {
      return { valid: false, error: "授权范围无效：" + (e && e.message), expireTimestamp: expireTimestamp, remainingDays: remainingDays, scope: f, version: payload.version || 2 };
    }
    const sensorType = expanded.isAllTypes
      ? "all"
      : Array.isArray(f) ? f.join(",") : String(f);

    return {
      valid: remainingDays > 0,
      expireTimestamp: expireTimestamp,
      sensorType: sensorType,
      sensorTypes: expanded.sensorTypes,
      isAllTypes: expanded.isAllTypes,
      groupKeys: expanded.groupKeys,
      scope: f,
      remainingDays: remainingDays,
      version: payload.version || 2,
      error: remainingDays > 0 ? undefined : "授权已过期",
    };
  } catch (e) {
    return { valid: false, error: "离线校验异常：" + (e && e.message) };
  }
}

/* ============================================================
 * v2 统一时间闸：防回拨（高水位）+ 永久锁定 + 在线状态缓存
 *
 * 设计动机：旧的 getTrustedNow 用 max(本机时间, 锚点) 做"可信时间"，只"钳制"
 *   不"拒绝"——用户在有效期内回拨时钟，可信时间退回锚点（仍未过期）就照用不误，
 *   防不住"有效期内任意回拨"。
 *
 * v2 改为：持久化一个 HMAC 签名的状态文件 { hw, locked, reason, lockedAt }
 *   - hw     = 已见过的最高可信时间（只增不减）
 *   - locked = 一旦检测到回拨即置 true，永久锁定，需厂商 RSA 解锁码（verifyUnlockCode）解锁
 *   离线 / 在线断网兜底都调用 checkTimeGuard()；在线联网时用服务器时间顶高水位。
 *
 * 限制（已知、与旧版一致）：删除状态文件可在纯离线下重置高水位；但状态文件被改字段
 *   会因 HMAC 不匹配直接判定锁定。在线密钥每次联网都用服务器时间重建高水位，删文件意义不大。
 * ============================================================ */

// 容差：允许本机时间相对高水位有最多 5 分钟的轻微倒退（NTP 校时/时区抖动），不算回拨
var ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
// 在线缓存刷新间隔：2 小时
var ONLINE_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

/** 对状态对象做稳定 HMAC（固定字段顺序，不含 sig 本身） */
function _signState(obj) {
  var base = JSON.stringify({
    hw: obj.hw || 0,
    locked: !!obj.locked,
    reason: obj.reason || "",
    lockedAt: obj.lockedAt || 0,
  });
  return CryptoJS.HmacSHA256(base, KEY_STR).toString();
}

/** 读状态文件；不存在→初始态；被篡改(HMAC 不符)→直接判定锁定 */
function _readState(filePath) {
  try {
    var fs = require("fs");
    if (!fs.existsSync(filePath)) return { hw: 0, locked: false, reason: "", lockedAt: 0 };
    var raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (raw.sig !== _signState(raw)) {
      return { hw: 0, locked: true, reason: "授权状态文件被篡改", lockedAt: 0, tampered: true };
    }
    return {
      hw: parseInt(raw.hw, 10) || 0,
      locked: !!raw.locked,
      reason: raw.reason || "",
      lockedAt: raw.lockedAt || 0,
    };
  } catch (e) {
    return { hw: 0, locked: false, reason: "", lockedAt: 0 };
  }
}

/** 写状态文件（带 HMAC 签名） */
function _writeState(filePath, obj) {
  try {
    var fs = require("fs");
    var out = { hw: obj.hw || 0, locked: !!obj.locked, reason: obj.reason || "", lockedAt: obj.lockedAt || 0 };
    out.sig = _signState(out);
    fs.writeFileSync(filePath, JSON.stringify(out));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 统一回拨闸（离线 / 在线断网兜底共用）。
 *   - 已锁定               → { ok:false, locked:true }
 *   - 当前时间 < 高水位-容差 → 判回拨 → 永久锁定 → { ok:false, locked:true, rolledBack:true }
 *   - 正常                 → 顶高水位 → { ok:true, now:currentMs }
 * @param {string} filePath  状态文件路径（建议放不显眼目录）
 * @param {number} currentMs 本次用于校验的时间：离线传本机时间，在线联网传服务器时间
 * @param {Object} [options] { toleranceMs }
 */
function checkTimeGuard(filePath, currentMs, options) {
  options = options || {};
  var tol = (typeof options.toleranceMs === "number") ? options.toleranceMs : ROLLBACK_TOLERANCE_MS;
  var st = _readState(filePath);

  if (st.locked) {
    return { ok: false, locked: true, rolledBack: false, reason: st.reason || "检测到异常行为", now: st.hw };
  }
  if (typeof currentMs !== "number" || isNaN(currentMs)) currentMs = Date.now();

  if (currentMs < st.hw - tol) {
    var reason = "检测到系统时间被回拨";
    _writeState(filePath, { hw: st.hw, locked: true, reason: reason, lockedAt: st.hw });
    return { ok: false, locked: true, rolledBack: true, reason: reason, now: st.hw };
  }

  var hw = currentMs > st.hw ? currentMs : st.hw;
  _writeState(filePath, { hw: hw, locked: false, reason: "", lockedAt: 0 });
  return { ok: true, locked: false, rolledBack: false, now: currentMs };
}

/** 当前是否处于锁定态（用于启动时决定弹"请联系厂商解锁"弹窗） */
function isLocked(filePath) {
  var st = _readState(filePath);
  return { locked: !!st.locked, reason: st.reason || "", lockedAt: st.lockedAt || 0 };
}

/**
 * 校验厂商解锁码（RSA-SHA256 验签）并清除锁定。
 * 解锁码由管理系统用私钥签发（见 server/db.ts generateUnlockCode）。
 * 验签通过 → 清除 locked，并把高水位顶到解锁码签发时间，避免立刻又触发回拨。
 * @param {string} filePath 状态文件路径
 * @param {string} code     base64 解锁码（{payload, signature} 的 base64）
 * @param {Object} [options] { publicKey } 覆盖默认公钥
 * @returns {{ok:boolean, unlockedAt?:number, error?:string}}
 */
function verifyUnlockCode(filePath, code, options) {
  options = options || {};
  try {
    var crypto = require("crypto");
    var publicKey = options.publicKey || OFFLINE_PUBLIC_KEY;
    if (!code) return { ok: false, error: "解锁码为空" };

    var envelope;
    try {
      envelope = JSON.parse(Buffer.from(code.trim(), "base64").toString("utf-8"));
    } catch (e) {
      return { ok: false, error: "解锁码格式错误" };
    }
    if (!envelope || !envelope.payload || !envelope.signature) {
      return { ok: false, error: "解锁码缺少 payload 或 signature" };
    }

    var verify = crypto.createVerify("RSA-SHA256");
    verify.update(envelope.payload);
    verify.end();
    if (!verify.verify(publicKey, envelope.signature, "base64")) {
      return { ok: false, error: "解锁码签名无效" };
    }

    var payload = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf-8"));
    if (payload.type !== "unlock") return { ok: false, error: "解锁码类型错误" };

    var st = _readState(filePath);
    var issuedAt = parseInt(payload.issuedAt, 10) || 0;
    var hw = issuedAt > st.hw ? issuedAt : st.hw;
    _writeState(filePath, { hw: hw, locked: false, reason: "", lockedAt: 0 });
    return { ok: true, unlockedAt: issuedAt };
  } catch (e) {
    return { ok: false, error: "解锁异常：" + (e && e.message) };
  }
}

/* ---------- 在线密钥本地缓存（服务器时间 + 密钥状态） ---------- */

/** 读在线缓存（HMAC 校验，被改返回 null） */
function readOnlineCache(filePath) {
  try {
    var fs = require("fs");
    if (!fs.existsSync(filePath)) return null;
    var raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (raw.sig !== CryptoJS.HmacSHA256(JSON.stringify(raw.d), KEY_STR).toString()) return null;
    return raw.d;
  } catch (e) {
    return null;
  }
}

/** 写在线缓存（HMAC 签名） */
function writeOnlineCache(filePath, data) {
  try {
    var fs = require("fs");
    var out = { d: data, sig: CryptoJS.HmacSHA256(JSON.stringify(data), KEY_STR).toString() };
    fs.writeFileSync(filePath, JSON.stringify(out));
    return true;
  } catch (e) {
    return false;
  }
}

/** 缓存是否该刷新（超过 intervalMs 未拉取，或从未拉过） */
function shouldRefreshOnlineCache(cache, nowMs, intervalMs) {
  if (!cache || !cache.fetchedAt) return true;
  var iv = (typeof intervalMs === "number") ? intervalMs : ONLINE_REFRESH_INTERVAL_MS;
  return (nowMs - cache.fetchedAt) >= iv;
}

/**
 * 在线密钥统一校验。整合方（Electron）负责实际联网拉 /serverTime + /licenseCheck，
 * 拉到就把结果作为 serverResult 传进来；断网传 null。
 * @param {Object} p
 * @param {string} p.statePath   回拨状态文件
 * @param {string} p.cachePath   在线缓存文件
 * @param {Object|null} p.serverResult  /licenseCheck 结果 { time, valid, status, reason, expireTimestamp, remainingDays, sensorTypes, isAllTypes }；断网传 null
 * @param {number} [p.localNow]  本机时间
 */
function evaluateOnlineLicense(p) {
  p = p || {};
  var localNow = (typeof p.localNow === "number") ? p.localNow : Date.now();

  // —— 在线：刷新缓存 + 用服务器时间顶高水位 ——
  if (p.serverResult && typeof p.serverResult.time === "number") {
    writeOnlineCache(p.cachePath, {
      status: p.serverResult.status,
      valid: !!p.serverResult.valid,
      expireTimestamp: p.serverResult.expireTimestamp,
      sensorTypes: p.serverResult.sensorTypes,
      isAllTypes: !!p.serverResult.isAllTypes,
      // v3：分类授权命中的分类 key，仅作展示/排查用（真正的授权判据是 sensorTypes）
      groupKeys: p.serverResult.groupKeys,
      serverTime: p.serverResult.time,
      fetchedAt: localNow,
    });
    var g1 = checkTimeGuard(p.statePath, p.serverResult.time);
    if (!g1.ok) return { valid: false, locked: g1.locked, rolledBack: g1.rolledBack, offline: false, reason: g1.reason };
    return {
      valid: !!p.serverResult.valid, locked: false, rolledBack: false, offline: false,
      status: p.serverResult.status, reason: p.serverResult.reason,
      expireTimestamp: p.serverResult.expireTimestamp, sensorTypes: p.serverResult.sensorTypes,
      isAllTypes: !!p.serverResult.isAllTypes, groupKeys: p.serverResult.groupKeys,
      remainingDays: p.serverResult.remainingDays,
    };
  }

  // —— 断网兜底：走回拨闸 + 缓存状态 + 本机时间判过期 ——
  var g = checkTimeGuard(p.statePath, localNow);
  if (!g.ok) {
    return { valid: false, locked: g.locked, rolledBack: g.rolledBack, offline: true, reason: g.reason || "检测到异常行为" };
  }
  var cache = readOnlineCache(p.cachePath);
  if (!cache) {
    // 从未成功联网过 → 无法判定 → 保守拒绝，引导先联网激活一次
    return { valid: false, locked: false, rolledBack: false, offline: true, reason: "尚未联网验证，请先联网激活一次" };
  }
  if (cache.status === "REVOKED") return { valid: false, locked: false, rolledBack: false, offline: true, status: "REVOKED", reason: "密钥已吊销" };
  if (cache.status === "SUSPENDED") return { valid: false, locked: false, rolledBack: false, offline: true, status: "SUSPENDED", reason: "密钥已暂停" };

  var expired = !!cache.expireTimestamp && localNow >= cache.expireTimestamp;
  var remainingDays = cache.expireTimestamp ? Math.ceil((cache.expireTimestamp - localNow) / 86400000) : null;
  return {
    valid: !expired, locked: false, rolledBack: false, offline: true,
    status: cache.status, reason: expired ? "密钥已过期" : undefined,
    expireTimestamp: cache.expireTimestamp, sensorTypes: cache.sensorTypes,
    isAllTypes: cache.isAllTypes, groupKeys: cache.groupKeys,
    remainingDays: remainingDays,
  };
}

/**
 * 离线密钥统一校验：回拨闸 + RSA 验签 + 本机时间判过期。
 * @param {Object} p { activationCode, statePath, localNow?, publicKey? }
 */
function evaluateOfflineLicense(p) {
  p = p || {};
  var localNow = (typeof p.localNow === "number") ? p.localNow : Date.now();
  var g = checkTimeGuard(p.statePath, localNow);
  if (!g.ok) {
    return { valid: false, locked: g.locked, rolledBack: g.rolledBack, reason: g.reason || "检测到异常行为" };
  }
  var res = verifyOfflineLicense(p.activationCode, { publicKey: p.publicKey, nowMs: localNow });
  res.locked = false;
  res.rolledBack = false;
  return res;
}

/* ---------- 防回拨时间锚点（v1，已废弃，保留向后兼容） ----------
 * @deprecated 改用 checkTimeGuard / evaluateOfflineLicense / evaluateOnlineLicense。
 * 旧逻辑只钳制不拒绝，防不住有效期内回拨；请勿在新接入中使用。
 */

/** 读取锚点文件里的最大时间戳（带 HMAC 校验，被改过则当作 0） */
function readTimeAnchor(filePath) {
  try {
    const fs = require("fs");
    if (!fs.existsSync(filePath)) return 0;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const expectSig = CryptoJS.HmacSHA256(String(raw.t), KEY_STR).toString();
    if (raw.sig !== expectSig) return 0; // 被篡改
    const t = parseInt(raw.t, 10);
    return isNaN(t) ? 0 : t;
  } catch (e) {
    return 0;
  }
}

/** 把时间戳写入锚点文件（带 HMAC 签名） */
function writeTimeAnchor(filePath, ms) {
  try {
    const fs = require("fs");
    const sig = CryptoJS.HmacSHA256(String(ms), KEY_STR).toString();
    fs.writeFileSync(filePath, JSON.stringify({ t: ms, sig: sig }));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 取一个"防回拨的可信当前时间"。
 * = max(本机时间, 锚点时间)，并把结果写回锚点（只增不减）。
 * @returns {{now:number, rolledBack:boolean}} now=可信时间，rolledBack=是否检测到往回调时间
 */
function getTrustedNow(filePath) {
  const systemNow = Date.now();
  const anchor = readTimeAnchor(filePath);
  const rolledBack = systemNow < anchor;
  const now = rolledBack ? anchor : systemNow;
  writeTimeAnchor(filePath, now);
  return { now: now, rolledBack: rolledBack };
}

module.exports = {
  aesEncrypt,
  aesDecrypt,
  generateLicenseKey,
  decodeLicenseKey,
  verifyOfflineLicense,
  // v3 分类授权
  GROUP_SCOPE_PREFIX,
  setLicenseSensorGroups,
  getLicenseSensorGroups,
  getLicenseGroupKeys,
  getGroupSensorTypes,
  getRegistrySensorTypes,
  validateLicenseSensorGroups,
  createGroupScopeToken,
  isGroupScopeToken,
  parseGroupScopeToken,
  containsGroupScopeToken,
  expandLicenseFile,
  normalizeLicenseFile,
  // v2 统一时间闸 / 锁定 / 解锁
  checkTimeGuard,
  isLocked,
  verifyUnlockCode,
  // 在线缓存 + 统一校验入口
  readOnlineCache,
  writeOnlineCache,
  shouldRefreshOnlineCache,
  evaluateOnlineLicense,
  evaluateOfflineLicense,
  ROLLBACK_TOLERANCE_MS,
  ONLINE_REFRESH_INTERVAL_MS,
  // v1 锚点（已废弃，保留兼容）
  getTrustedNow,
  readTimeAnchor,
  writeTimeAnchor,
  OFFLINE_PUBLIC_KEY,
  SENSOR_GROUPS,
  ALL_SENSORS,
  SENSOR_LABEL_MAP,
};
