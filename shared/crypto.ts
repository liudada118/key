/**
 * AES-256-GCM 加密/解密模块
 * 
 * 独立模块，可在 Web 端和 Electron 端使用。
 * Electron 端使用时，复制 crypto-lib.cjs 文件即可通过 require() 引入。
 * 
 * 密钥格式: IV(24 hex) + AuthTag(32 hex) + Ciphertext(hex)
 * 加密密钥: 由固定字符串 SHA-256 派生为 32 字节密钥
 */
import CryptoJS from "crypto-js";

const PASSPHRASE = "JIANXINGZHE-KEY-MANAGER-2026";

/** 从固定口令派生 256-bit 密钥 */
function deriveKey(): CryptoJS.lib.WordArray {
  return CryptoJS.SHA256(PASSPHRASE);
}

/** 加密明文 → hex 字符串 (iv + tag + ciphertext) */
export function aesEncrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = CryptoJS.lib.WordArray.random(12); // 96-bit IV for GCM

  // CryptoJS 没有原生 GCM，使用 CTR 模式 + HMAC 实现认证加密
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv: iv,
    mode: CryptoJS.mode.CTR,
    padding: CryptoJS.pad.NoPadding,
  });

  const ciphertext = encrypted.ciphertext.toString(); // hex
  const ivHex = iv.toString(); // 24 hex chars (12 bytes)

  // HMAC-SHA256 作为认证标签 (对 iv + ciphertext 签名)
  const authTag = CryptoJS.HmacSHA256(ivHex + ciphertext, key).toString().substring(0, 32);

  // 格式: iv(24) + authTag(32) + ciphertext
  return ivHex + authTag + ciphertext;
}

/** 解密 hex 字符串 → 明文，失败返回 null */
export function aesDecrypt(hexStr: string): string | null {
  try {
    if (!hexStr || hexStr.length < 58) return null;

    const key = deriveKey();
    const ivHex = hexStr.substring(0, 24);
    const authTag = hexStr.substring(24, 56);
    const ciphertext = hexStr.substring(56);

    // 验证认证标签
    const expectedTag = CryptoJS.HmacSHA256(ivHex + ciphertext, key).toString().substring(0, 32);
    if (authTag !== expectedTag) return null; // 篡改检测

    const iv = CryptoJS.enc.Hex.parse(ivHex);
    const ciphertextWA = CryptoJS.enc.Hex.parse(ciphertext);

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: ciphertextWA,
    });

    const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
      iv: iv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
    });

    const result = decrypted.toString(CryptoJS.enc.Utf8);
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 传感器类型分组定义
 * 与 Shroom1.0 (1.0分支) License.jsx 完全一致
 */
export const SENSOR_GROUPS = [
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

/** 所有传感器的平铺列表 */
export const ALL_SENSORS: { label: string; value: string }[] = SENSOR_GROUPS.flatMap((g) => [...g.items]);

/** 传感器 value → label 映射 */
export const SENSOR_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ALL_SENSORS.map((s) => [s.value, s.label])
);

/** 旧的 SENSOR_TYPES 保留兼容（平铺列表 + all） */
export const SENSOR_TYPES: { label: string; value: string }[] = [
  ...ALL_SENSORS,
  { label: "全部类型", value: "all" },
];

export type SensorTypeValue = string;

/** 密钥类型 */
export type KeyCategory = "production" | "rental";

export const KEY_CATEGORIES = [
  { label: "量产密钥", value: "production" as KeyCategory },
  { label: "在线租赁密钥", value: "rental" as KeyCategory },
] as const;

/**
 * 生成密钥
 * @param sensorTypes 传感器类型 - 可以是单个 string、string 数组或 "all"
 * @param days 有效期天数
 * @param category 密钥类型: production(量产) / rental(在线租赁)
 * @returns hex 格式密钥字符串
 */
export function generateLicenseKey(
  sensorTypes: string | string[],
  days: number,
  category: KeyCategory = "production"
): string {
  const expireTimestamp = Date.now() + days * 24 * 60 * 60 * 1000;

  // file 字段: "all" / 单个 string / string 数组
  let file: string | string[];
  if (sensorTypes === "all") {
    file = "all";
  } else if (Array.isArray(sensorTypes)) {
    file = sensorTypes.length === 1 ? sensorTypes[0] : sensorTypes;
  } else {
    file = sensorTypes;
  }

  const payload = JSON.stringify({
    date: expireTimestamp,
    file,
    cat: category,
    v: 2,
  });
  return aesEncrypt(payload);
}

/** 解密密钥返回的信息结构 */
export interface DecodedKey {
  valid: boolean;
  expireTimestamp?: number;
  sensorType?: string;
  sensorTypes?: string[];
  isAllTypes?: boolean;
  category?: KeyCategory;
  expireDate?: string;
  remainingDays?: number;
  version?: number;
  error?: string;
}

/**
 * 解密密钥，返回解析后的信息
 */
export function decodeLicenseKey(hexKey: string): DecodedKey {
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
    const now = Date.now();
    const remainingMs = expireTimestamp - now;
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    const expireDate = new Date(expireTimestamp).toISOString();

    // 解析 file 字段
    let sensorType: string | undefined;
    let sensorTypes: string[] | undefined;
    let isAllTypes = false;

    if (parsed.file === "all") {
      isAllTypes = true;
      sensorType = "all";
      sensorTypes = ALL_SENSORS.map((s) => s.value);
    } else if (Array.isArray(parsed.file)) {
      sensorTypes = parsed.file;
      sensorType = parsed.file.join(",");
    } else {
      sensorType = parsed.file;
      sensorTypes = [parsed.file];
    }

    return {
      valid: remainingDays > 0,
      expireTimestamp,
      sensorType,
      sensorTypes,
      isAllTypes,
      category: parsed.cat || "production",
      expireDate,
      remainingDays,
      version: parsed.v || 1,
    };
  } catch {
    return { valid: false, error: "解密失败：密钥格式错误" };
  }
}
