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
 * 支持多选传感器类型（数组）和 "all" 全选。
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

    // 解析传感器类型
    let sensorType, sensorTypes, isAllTypes = false;
    const f = payload.sensorTypes;
    if (f === "all") {
      isAllTypes = true; sensorType = "all"; sensorTypes = ALL_SENSORS.map(function (s) { return s.value; });
    } else if (Array.isArray(f)) {
      sensorTypes = f; sensorType = f.join(",");
    } else {
      sensorType = f; sensorTypes = [f];
    }

    return {
      valid: remainingDays > 0,
      expireTimestamp: expireTimestamp,
      sensorType: sensorType,
      sensorTypes: sensorTypes,
      isAllTypes: isAllTypes,
      remainingDays: remainingDays,
      version: payload.version || 2,
      error: remainingDays > 0 ? undefined : "授权已过期",
    };
  } catch (e) {
    return { valid: false, error: "离线校验异常：" + (e && e.message) };
  }
}

/* ---------- 防回拨时间锚点 ----------
 * 把"见过的最大时间"签名后存到本地文件；每次取一个"可信的当前时间"。
 * 用户把系统时间往回调时，可信时间不会跟着变小 → 防止白嫖。
 * 注意：删除锚点文件可重置，建议桌面端把它放到不显眼的目录并设多份备份。
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
  getTrustedNow,
  readTimeAnchor,
  writeTimeAnchor,
  OFFLINE_PUBLIC_KEY,
  SENSOR_GROUPS,
  ALL_SENSORS,
  SENSOR_LABEL_MAP,
};
