import type { Express } from "express";
import { decodeLicenseKey } from "../shared/crypto";
import { getDb, getLicenseKeyByString, markLicenseKeyActivated, markLicenseKeyExpired, recordClientTimeAndDetectTamper } from "./db";
import { authorizeLicenseDevice, DEVICE_ID_PATTERN, signLicenseDeviceLease } from "./licenseDevices";
import { normalizeLicenseProduct, licenseSdkFeatures } from "../shared/licenseProducts";

/** Preserve legacy desktop keys while issuing signed computer allowances and enforcing registered policies. */
export function registerOnlineLicenseCheck(app: Express) {
  app.options("/licenseCheck", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.sendStatus(204);
  });
  app.post("/licenseCheck", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    const now = Date.now();
    let requestedProduct;
    try { requestedProduct = normalizeLicenseProduct(req.body?.productType); }
    catch { return res.status(400).json({ time: now, valid: false, status: "PRODUCT_INVALID" }); }
    const key = (req.body && req.body.key ? String(req.body.key) : "").trim().toLowerCase();
    if (!key) {
      return res.status(400).json({ time: now, valid: false, status: "INVALID", reason: "缺少 key" });
    }
    // 客户端可选上报：本机时间（防回拨高水位）与自检篡改标记
    const clientTime = req.body && req.body.clientTime != null ? Number(req.body.clientTime) : undefined;
    const tamperReported = !!(req.body && req.body.tamper);

    // 用服务器时间判过期
    const decoded = decodeLicenseKey(key, now);
    // 解密失败/格式错误（无到期时间即视为无法解析），或授权范围无法展开
    //（v3 未知 `@group:` 分类 / 空范围：有到期时间但拿不到 sensorTypes）——
    // 一律判 INVALID，不能降级成"授权 0 个系统但 valid"。
    if (!decoded.valid && decoded.error && (!decoded.expireTimestamp || !decoded.sensorTypes)) {
      return res.json({ time: now, valid: false, status: "INVALID", reason: decoded.error });
    }
    if (normalizeLicenseProduct(decoded.productType) !== requestedProduct) {
      return res.json({ time: now, valid: false, status: "PRODUCT_MISMATCH", productType: decoded.productType,
        expireTimestamp: now - 1, reason: "密钥所属产品与当前客户端不一致。" });
    }

    let status: string = "UNKNOWN";
    let reason: string | undefined = decoded.valid ? undefined : "密钥已过期";
    let valid = decoded.valid;
    // 在线密钥到期以数据库 expireTimestamp 为权威（支持后台续期延长当前密钥）；
    // 无记录的普通旧码沿用密文日期；电脑凭证不创建正式密钥记录，存储不可用返回 503。
    let effectiveExpire: number | null = decoded.expireTimestamp ?? null;
    let deviceLimit = 0;
    let deviceLease: Awaited<ReturnType<typeof authorizeLicenseDevice>>["deviceLease"];

    try {
      if (!await getDb()) throw new Error("DEVICE_STORAGE_UNAVAILABLE");
      const rec = await getLicenseKeyByString(key);
      if (rec && normalizeLicenseProduct(rec.productType) !== requestedProduct) {
        return res.json({ time: now, valid: false, status: "PRODUCT_MISMATCH", productType: normalizeLicenseProduct(rec.productType),
          expireTimestamp: now - 1, reason: "密钥所属产品与当前客户端不一致。" });
      }
      if (!rec && requestedProduct === "shroom-sdk") {
        return res.json({ time: now, valid: false, status: "LICENSE_NOT_REGISTERED",
          reason: "原密钥需要同步登记。请管理员在授权网站“密钥验证”中核对并登记原密钥，然后联网重试，无需更换密钥。",
          expireTimestamp: effectiveExpire, remainingDays: decoded.remainingDays ?? null,
          deviceLimit: 0 });
      }
      if (!rec && req.body?.deviceId != null) {
        if (typeof req.body.deviceId !== "string" || !DEVICE_ID_PATTERN.test(req.body.deviceId)) {
          return res.json({ time: now, valid: false, status: "DEVICE_ID_REQUIRED", reason: "电脑授权标识无效，请更新客户端后重试。",
            expireTimestamp: effectiveExpire, deviceLimit: 0 });
        }
        if (tamperReported) {
          valid = false; status = "TAMPERED"; reason = "密钥异常：客户端报告授权校验异常。";
        } else if (decoded.valid && Number.isFinite(effectiveExpire) && effectiveExpire! > now) {
          // ⚠️ 只签原普通密钥的电脑凭证；不能自动创建客户或正式授权记录。
          deviceLease = signLicenseDeviceLease({ keyString: key, deviceId: req.body.deviceId, expireTimestamp: effectiveExpire!, deviceLimit: 0 }, now);
          status = "LEGACY_VALID";
        } else {
          valid = false; status = "EXPIRED"; reason = "密钥已过期";
        }
      }
      if (rec) {
        status = rec.status;
        // 到期改以数据库为准（续期会更新这个字段）
        effectiveExpire = rec.expireTimestamp;
        const notExpired = now < rec.expireTimestamp;
        valid = notExpired;
        reason = notExpired ? undefined : "密钥已过期";
        // 防回拨/篡改检测：维护可信时间高水位；检测到回拨或客户端上报篡改 → 标记 TAMPERED（持久化）
        const tamperResult = await recordClientTimeAndDetectTamper({
          keyId: rec.id,
          clientTime,
          tamperReported,
          serverNow: now,
        });
        if (tamperResult) status = tamperResult.status;

        if (rec.isDeleted || status === "REVOKED") {
          valid = false;
          status = "REVOKED";
          reason = rec.revokeReason || "密钥已吊销";
        } else if (status === "SUSPENDED") {
          valid = false;
          reason = rec.suspendReason || "密钥已暂停";
        } else if (status === "TAMPERED") {
          valid = false;
          reason = rec.tamperReason || "密钥异常：检测到时间回拨或客户端篡改";
        } else if (!notExpired) {
          // 已过期（按数据库到期判定）：统一返回 EXPIRED 并持久化
          valid = false;
          status = "EXPIRED";
          reason = "密钥已过期";
          await markLicenseKeyExpired(rec.id);
        } else if (!rec.isActivated) {
          // 首次有效校验 → 标记为已激活（在线版"使用即激活"）
          await markLicenseKeyActivated(key);
          status = "ACTIVATED";
        }
        if (valid) {
          // Bind the allowance to the canonical request: older rows may store uppercase hex.
          const device = await authorizeLicenseDevice({ ...rec, keyString: key }, req.body?.deviceId, now);
          deviceLimit = device.deviceLimit;
          deviceLease = device.deviceLease;
          if (!device.allowed) {
            valid = false;
            status = device.code;
            reason = device.code === "DEVICE_LIMIT_REACHED" ? "此密钥的电脑数量已达上限，请联系管理员解绑旧电脑或增加名额。"
              : device.code === "DEVICE_REVOKED" ? "这台电脑已被解绑，请联系管理员恢复授权。"
                : "此密钥已限定电脑数量，请更新客户端后重新激活。";
            // Old clients ignore cached valid=false; an expired result prevents their cache from granting access.
            effectiveExpire = now - 1;
          }
        }
      }
    } catch (e) {
      // Missing policy storage or signing keys cannot silently turn a limited key into an unlimited key.
      return res.status(503).json({ error: "LICENSE_SERVICE_UNAVAILABLE" });
    }

    const effectiveRemainingDays = effectiveExpire != null
      ? Math.ceil((effectiveExpire - now) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      time: now,
      productType: requestedProduct,
      sdkFeatures: licenseSdkFeatures(requestedProduct),
      leaseExpiresAt: valid && effectiveExpire != null ? Math.min(effectiveExpire, now + 60000) : now,
      valid,
      status,
      reason,
      expireTimestamp: effectiveExpire,
      remainingDays: effectiveRemainingDays,
      deviceLimit,
      ...(deviceLease ? { deviceLease } : {}),
      // sensorTypes 已按当前注册表展开：分类密钥在这里自动拿到新增系统
      sensorTypes: requestedProduct === "shroom-sdk" ? ["all"] : decoded.sensorTypes ?? null,
      isAllTypes: requestedProduct === "shroom-sdk" || (decoded.isAllTypes ?? false),
      // v3：命中的分类 key（无分类授权为空数组），仅供客户端展示/排查
      groupKeys: requestedProduct === "shroom-sdk" ? [] : decoded.groupKeys ?? [],
      // 密钥里原样保存的授权范围（含 `@group:` 令牌），便于对账
      scope: requestedProduct === "shroom-sdk" ? "all" : decoded.scope ?? null,
    });
  });
}
