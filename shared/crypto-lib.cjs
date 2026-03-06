/**
 * AES-256-GCM 加密/解密模块 (CommonJS 版本)
 * 
 * 用于 Electron 项目中通过 require() 引入
 * 使用方法: const { generateLicenseKey, decodeLicenseKey, aesEncrypt, aesDecrypt } = require('./crypto-lib.cjs');
 * 
 * 依赖: npm install crypto-js
 * 
 * 密钥格式: IV(24 hex) + AuthTag(32 hex) + Ciphertext(hex)
 */
const CryptoJS = require("crypto-js");

const PASSPHRASE = "JIANXINGZHE-KEY-MANAGER-2026";

function deriveKey() {
  return CryptoJS.SHA256(PASSPHRASE);
}

function aesEncrypt(plaintext) {
  const key = deriveKey();
  const iv = CryptoJS.lib.WordArray.random(12);

  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv: iv,
    mode: CryptoJS.mode.CTR,
    padding: CryptoJS.pad.NoPadding,
  });

  const ciphertext = encrypted.ciphertext.toString();
  const ivHex = iv.toString();
  const authTag = CryptoJS.HmacSHA256(ivHex + ciphertext, key).toString().substring(0, 32);

  return ivHex + authTag + ciphertext;
}

function aesDecrypt(hexStr) {
  try {
    if (!hexStr || hexStr.length < 58) return null;

    const key = deriveKey();
    const ivHex = hexStr.substring(0, 24);
    const authTag = hexStr.substring(24, 56);
    const ciphertext = hexStr.substring(56);

    const expectedTag = CryptoJS.HmacSHA256(ivHex + ciphertext, key).toString().substring(0, 32);
    if (authTag !== expectedTag) return null;

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
  } catch (e) {
    return null;
  }
}

const SENSOR_TYPES = [
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
];

function generateLicenseKey(sensorType, days, category) {
  category = category || "production";
  const expireTimestamp = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({
    date: expireTimestamp,
    file: sensorType,
    cat: category,
    v: 2,
  });
  return aesEncrypt(payload);
}

function decodeLicenseKey(hexKey) {
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
      expireTimestamp: expireTimestamp,
      sensorType: parsed.file,
      category: parsed.cat || "production",
      expireDate: expireDate,
      remainingDays: remainingDays,
      version: parsed.v || 1,
    };
  } catch (e) {
    return { valid: false, error: "解密失败：密钥格式错误" };
  }
}

module.exports = {
  aesEncrypt,
  aesDecrypt,
  generateLicenseKey,
  decodeLicenseKey,
  SENSOR_TYPES,
};
