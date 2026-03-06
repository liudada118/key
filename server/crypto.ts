/**
 * AES-ECB 加密/解密模块
 * 兼容 Shroom1.0 系统的密钥格式
 * 固定密钥: JIANXINGZHEPSVMC
 */
import CryptoJS from "crypto-js";

const KEY_STR = "JIANXINGZHEPSVMC";

function stringToHex(str: string): string {
  let hex = "";
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16);
  }
  return hex;
}

function getKey() {
  return CryptoJS.enc.Hex.parse(stringToHex(KEY_STR));
}

/** Encrypt a plaintext string → hex ciphertext */
export function aesEncrypt(src: string): string {
  const key = getKey();
  const encrypted = CryptoJS.AES.encrypt(src, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.ciphertext.toString();
}

/** Decrypt a hex ciphertext → plaintext string */
export function aesDecrypt(hexCipher: string): string {
  const key = getKey();
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.format.Hex.parse(hexCipher),
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }
  );
  return CryptoJS.enc.Utf8.stringify(decrypted);
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

/**
 * 生成密钥
 * @param sensorType 传感器类型 value
 * @param days 有效期天数
 * @returns hex 格式密钥字符串
 */
export function generateLicenseKey(sensorType: string, days: number): string {
  const expireTimestamp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ date: expireTimestamp, file: sensorType });
  return aesEncrypt(payload);
}

/**
 * 解密密钥，返回解析后的信息
 */
export function decodeLicenseKey(hexKey: string): {
  valid: boolean;
  expireTimestamp?: number;
  sensorType?: string;
  expireDate?: string;
  remainingDays?: number;
  error?: string;
} {
  try {
    const plaintext = aesDecrypt(hexKey.trim());
    if (!plaintext) {
      return { valid: false, error: "解密失败：无效的密钥格式" };
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
      expireDate,
      remainingDays,
    };
  } catch (e) {
    return { valid: false, error: "解密失败：密钥格式错误" };
  }
}
