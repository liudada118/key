/**
 * AES-256-GCM 加密/解密模块 (CommonJS 版本)
 * 
 * 用于 Electron 项目中通过 require() 引入
 * 使用方法: const { generateLicenseKey, decodeLicenseKey, aesEncrypt, aesDecrypt } = require('./crypto-lib.cjs');
 * 
 * 依赖: npm install crypto-js
 * 
 * 密钥格式: IV(24 hex) + AuthTag(32 hex) + Ciphertext(hex)
 * 支持多选传感器类型（数组）和 "all" 全选
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

/**
 * 生成密钥
 * @param {string|string[]} sensorTypes - 传感器类型，可以是单个 string、string 数组或 "all"
 * @param {number} days - 有效期天数
 * @param {string} category - 密钥类型: "production"(量产) / "rental"(在线租赁)
 * @returns {string} hex 格式密钥字符串
 */
function generateLicenseKey(sensorTypes, days, category) {
  category = category || "production";
  const expireTimestamp = Date.now() + days * 24 * 60 * 60 * 1000;

  var file;
  if (sensorTypes === "all") {
    file = "all";
  } else if (Array.isArray(sensorTypes)) {
    file = sensorTypes.length === 1 ? sensorTypes[0] : sensorTypes;
  } else {
    file = sensorTypes;
  }

  const payload = JSON.stringify({
    date: expireTimestamp,
    file: file,
    cat: category,
    v: 2,
  });
  return aesEncrypt(payload);
}

/**
 * 解密密钥，返回解析后的信息
 * @param {string} hexKey - hex 格式密钥字符串
 * @returns {Object} 解析结果
 */
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

    var sensorType, sensorTypes, isAllTypes = false;

    if (parsed.file === "all") {
      isAllTypes = true;
      sensorType = "all";
      sensorTypes = ALL_SENSORS.map(function(s) { return s.value; });
    } else if (Array.isArray(parsed.file)) {
      sensorTypes = parsed.file;
      sensorType = parsed.file.join(",");
    } else {
      sensorType = parsed.file;
      sensorTypes = [parsed.file];
    }

    return {
      valid: remainingDays > 0,
      expireTimestamp: expireTimestamp,
      sensorType: sensorType,
      sensorTypes: sensorTypes,
      isAllTypes: isAllTypes,
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
  SENSOR_GROUPS,
  ALL_SENSORS,
  SENSOR_LABEL_MAP,
};
