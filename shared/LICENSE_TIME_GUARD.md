# 授权时间校验集成说明（v2 防回拨 + 在线缓存）

本说明配套 `shared/crypto-lib.cjs`，给 Electron 客户端接入用。服务端无需改动，
已提供 `/serverTime` 和 `/licenseCheck` 两个接口。

## 设计要点

- **回拨即锁死**：持久化"已见最高可信时间"高水位。本机时间低于高水位（超过 5 分钟容差）
  即判定时间被回拨，**永久锁定**，需厂商解锁码解锁。不再像旧版 `getTrustedNow` 那样
  "钳制后继续"（旧版防不住有效期内回拨，已废弃）。
- **在线不一断网就锁**：在线密钥本地缓存服务器时间 + 密钥状态，每 2 小时联网刷新一次；
  断网时走离线那套回拨闸——没回拨、缓存未过期/未吊销就继续用；联网恢复再刷新。
- **离线/在线共用同一回拨闸** `checkTimeGuard`。

## 文件（建议放不显眼目录，可多份备份）   

| 文件 | 内容 |
|:---|:---|
| 状态文件 `statePath` | `{ hw, locked, reason, lockedAt }`，HMAC 签名。被改字段→直接判锁定 |
| 在线缓存 `cachePath` | `{ serverTime, status, expireTimestamp, sensorTypes, isAllTypes, fetchedAt }`，HMAC 签名 |

> 已知限制：纯离线下删除状态文件可重置高水位（与旧版一致）。在线密钥每次联网用服务器
> 时间重建高水位，删文件意义不大。建议把文件藏到不显眼路径并存多份冗余。

## 离线密钥接入

```js
const L = require("./crypto-lib.cjs");
const path = require("path");
const STATE = path.join(app.getPath("userData"), ".lic_state");

const r = L.evaluateOfflineLicense({
  activationCode,           // 离线激活码
  statePath: STATE,
  // localNow 默认本机时间
});

if (r.locked) showLockDialog(r.reason);     // 永久锁定 → 弹"请联系厂商解锁"
else if (!r.valid) showError(r.error);       // 过期/验签失败
else enableApp(r.sensorTypes, r.remainingDays);
```

## 在线密钥接入（核心：每 2h 拉一次 + 断网兜底）

```js
const L = require("./crypto-lib.cjs");
const CACHE = path.join(app.getPath("userData"), ".lic_cache");
const STATE = path.join(app.getPath("userData"), ".lic_state");
const BASE  = "https://你的服务器:3000";

async function fetchLicense(key) {
  // 联网拉 /licenseCheck（内含服务器时间）。失败/超时返回 null 即走断网兜底。
  try {
    const resp = await fetch(BASE + "/licenseCheck", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }), signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    return await resp.json();   // { time, valid, status, reason, expireTimestamp, remainingDays, sensorTypes, isAllTypes }
  } catch { return null; }
}

async function checkOnline(key) {
  const cache = L.readOnlineCache(CACHE);
  // 启动时、或缓存超过 2h 才真正联网；否则直接用缓存走兜底（省流量、扛抖动）
  const needFetch = L.shouldRefreshOnlineCache(cache, Date.now());
  const serverResult = needFetch ? await fetchLicense(key) : null;

  const r = L.evaluateOnlineLicense({ key, statePath: STATE, cachePath: CACHE, serverResult });

  if (r.locked)      showLockDialog(r.reason);          // 回拨锁定 → 弹窗联系厂商
  else if (!r.valid) showError(r.reason);               // 吊销/暂停/过期/未联网激活
  else               enableApp(r.sensorTypes, r.remainingDays);
  return r;
}

// 启动时跑一次；运行中每隔（建议）几分钟跑一次 checkOnline()
// —— 高水位"运行中定期更新"就靠这个轮询；联网到点(2h)会真正刷新，没到点用缓存。
setInterval(() => checkOnline(currentKey), 5 * 60 * 1000);
```

> 演示防抖：网络偶发抖动时 `fetchLicense` 返回 null，`evaluateOnlineLicense` 自动走缓存，
> 只要没动时钟、缓存未过期就继续可用，不会因为一次请求失败就锁。

## 锁定弹窗

```js
function showLockDialog(reason) {
  dialog.showErrorBox("授权异常", (reason || "检测到异常行为") + "，请联系厂商解锁。");
  // 提供一个输入框让用户粘贴厂商发的解锁码：
  // const r = L.verifyUnlockCode(STATE, codeFromUser);
  // if (r.ok) { /* 解锁成功，重启校验 */ } else { /* r.error */ }
}
```

## 厂商签发解锁码

管理系统侧调用 `server/db.ts` 的 `generateUnlockCode()` 生成 base64 解锁码发给客户：

```ts
import { generateUnlockCode } from "./db";
const { code } = await generateUnlockCode();   // 把 code 发给客户粘贴到客户端
```

客户端 `L.verifyUnlockCode(statePath, code)` 用内置 RSA 公钥验签，通过即清除锁定。

> 注意：当前解锁码未绑定机器码（与离线版策略一致），同一码可在任意机器解锁。
> 如需一机一码，在 `generateUnlockCode` 的 payload 里加 `machineId`，并让客户端在
> `verifyUnlockCode` 时校验本机机器码匹配。
