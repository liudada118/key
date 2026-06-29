/**
 * AES-ECB 加密/解密模块
 *
 * 独立模块，可在 Web 端和 Electron 端使用。
 * Electron 端使用时，复制 crypto-lib.cjs 文件即可通过 require() 引入。
 *
 * 算法与桌面端 shroom1.0 (aesUtil.js / aes_ecb.js) 完全一致：
 *   AES / ECB / Pkcs7，密钥 = "JIANXINGZHEPSVMC" 逐字符转 hex 后 Hex.parse（AES-128）。
 *   输出为纯 hex 密文（无 IV、无认证标签）。
 *   这样新系统生成的密钥与桌面端互通，老客户的 ECB 密钥也能继续解。
 *
 * 注意：ECB 无随机 IV、无认证标签——相同明文得相同密文，且不做篡改检测
 *      （与桌面端历史行为保持一致；防伪造由离线版的 RSA 签名负责）。
 */
import CryptoJS from "crypto-js";

const KEY_STR = "JIANXINGZHEPSVMC";

/** 把口令逐字符转 hex 再 Hex.parse 成 WordArray（与桌面端 stringToHex 一致） */
function deriveKey(): CryptoJS.lib.WordArray {
  let hex = "";
  for (let i = 0; i < KEY_STR.length; i++) {
    hex += KEY_STR.charCodeAt(i).toString(16);
  }
  return CryptoJS.enc.Hex.parse(hex);
}

/** 加密明文 → hex 密文（AES-ECB/Pkcs7） */
export function aesEncrypt(plaintext: string): string {
  const key = deriveKey();
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.ciphertext.toString(); // hex
}

/** 解密 hex 密文 → 明文，失败返回 null */
export function aesDecrypt(hexStr: string): string | null {
  try {
    if (!hexStr) return null;
    const key = deriveKey();
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.format.Hex.parse(hexStr) as unknown as CryptoJS.lib.CipherParams,
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
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
    // 随机 nonce：ECB 是确定性加密，相同参数会产出相同密文；加随机字段保证每把密钥串唯一。
    // 桌面端解密后只读 date/file/cat，自动忽略该字段，无需改动。
    n: CryptoJS.lib.WordArray.random(8).toString(),
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
 * @param hexKey hex 密钥字符串
 * @param nowMs 可选，判过期所用的"当前时间"(ms)。
 *              在线版传服务器时间、离线版传防回拨锚点时间；不传则用本机 Date.now()。
 */
export function decodeLicenseKey(hexKey: string, nowMs?: number): DecodedKey {
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
    const now = (typeof nowMs === "number" && !Number.isNaN(nowMs)) ? nowMs : Date.now();
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
