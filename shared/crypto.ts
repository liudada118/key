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
  // CTR 加密
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
    if (!hexStr || hexStr.length < 58) return null; // 最小长度: 24(iv) + 32(tag) + 2(最小密文)

    const key = deriveKey();
    const ivHex = hexStr.substring(0, 24);
    const authTag = hexStr.substring(24, 56);
    const ciphertext = hexStr.substring(56);

    // 验证认证标签
    const expectedTag = CryptoJS.HmacSHA256(ivHex + ciphertext, key).toString().substring(0, 32);
    if (authTag !== expectedTag) return null; // 篡改检测

    const iv = CryptoJS.enc.Hex.parse(ivHex);
    const ciphertextWA = CryptoJS.enc.Hex.parse(ciphertext);

    // 构造 CipherParams 对象
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

/** 传感器类型列表 */
export const SENSOR_TYPES = [
  { label: "轮椅", value: "yanfeng10" },
  { label: "脚型检测", value: "foot" },
  { label: "臀部监测", value: "sit" },
  { label: "手部检测", value: "hand" },
  { label: "汽车", value: "car" },
  { label: "小床监测", value: "jqbed" },
  { label: "小床褥采集", value: "matCol" },
  { label: "小床睡姿采集", value: "matColPos" },
  { label: "车载传感器", value: "carCol" },
  { label: "正常测试", value: "normal" },
  { label: "手套监测", value: "newHand" },
  { label: "席悦1.0", value: "smallBed" },
  { label: "席悦2.0", value: "xiyueReal1" },
  { label: "全部类型", value: "all" },
] as const;

export type SensorTypeValue = (typeof SENSOR_TYPES)[number]["value"];

/** 密钥类型 */
export type KeyCategory = "production" | "rental";

export const KEY_CATEGORIES = [
  { label: "量产密钥", value: "production" as KeyCategory },
  { label: "在线租赁密钥", value: "rental" as KeyCategory },
] as const;

/**
 * 生成密钥
 * @param sensorType 传感器类型 value
 * @param days 有效期天数
 * @param category 密钥类型: production(量产) / rental(在线租赁)
 * @returns hex 格式密钥字符串
 */
export function generateLicenseKey(
  sensorType: string,
  days: number,
  category: KeyCategory = "production"
): string {
  const expireTimestamp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({
    date: expireTimestamp,
    file: sensorType,
    cat: category,
    v: 2, // 版本号，区分旧格式
  });
  return aesEncrypt(payload);
}

/** 解密密钥返回的信息结构 */
export interface DecodedKey {
  valid: boolean;
  expireTimestamp?: number;
  sensorType?: string;
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

    return {
      valid: remainingDays > 0,
      expireTimestamp,
      sensorType: parsed.file,
      category: parsed.cat || "production",
      expireDate,
      remainingDays,
      version: parsed.v || 1,
    };
  } catch {
    return { valid: false, error: "解密失败：密钥格式错误" };
  }
}
