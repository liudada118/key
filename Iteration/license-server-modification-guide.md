# 发证服务分类授权与新增系统同步改造文档

> 适用项目：Shroom 桌面端 `E:\shroom1` 与线上发证服务
>
> 目标服务：`https://shroom.jq-industries.com`
>
> 文档日期：2026-08-19

## 1. 改造目标

发证服务需要支持以下授权范围：

- 全部系统：`all`
- 单个系统：例如 `humanBodyOptimized`
- 固定系统列表：例如 `["hand0205", "humanBodyOptimized"]`
- 分类全部：例如 `@group:precision`
- 分类与单系统混合：例如 `["@group:care", "humanBodyOptimized"]`

分类密钥必须保存稳定的 `@group:<groupKey>` 令牌，不能在签发时保存当时展开的系统数组。这样以后向分类中增加系统时，未过期的旧分类密钥可在新版客户端中自动获得新增系统。

## 2. 唯一数据源

分类与系统归属的唯一数据源是桌面端根目录：

```text
E:\shroom1\licenseSensorGroups.json
```

当前包含五个分类：

| groupKey | 中文含义 | 密钥令牌 |
| --- | --- | --- |
| `common` | 常用全部 | `@group:common` |
| `care` | 关怀全部 | `@group:care` |
| `lab` | 实验室全部 | `@group:lab` |
| `custom` | 定制全部 | `@group:custom` |
| `precision` | 精密全部 | `@group:precision` |

服务端不得再维护另一份手写分类数组。分类下拉、密钥生成、密钥校验都应加载同步后的同一份 JSON。

## 3. 注册表同步

### 3.1 同步命令

在 `E:\shroom1` 执行：

```powershell
node scripts/sync-license-registry.cjs D:\实际发证服务\config\licenseSensorGroups.json
```

目标目录必须提前存在。命令会：

1. 校验分类数组非空。
2. 校验 `group.key` 唯一且有效。
3. 校验每个分类至少包含一个系统。
4. 校验所有展示系统 `value` 全局唯一。
5. 写入目标 JSON。
6. 重新读取目标文件并校验 SHA-256。
7. 输出分类数量、系统数量和 SHA-256。

建议在发证服务 CI/CD 中记录该 SHA-256，部署前与桌面端执行结果对比。

### 3.2 建议服务端目录

```text
license-server/
├── config/
│   └── licenseSensorGroups.json
├── src/
│   ├── licenseRegistry.js
│   ├── licenseIssuer.js
│   └── routes/
│       ├── license.js
│       └── sensorTypes.js
└── package.json
```

## 4. 服务端注册表模块

服务启动时加载并校验注册表，注册表无效时应终止启动，避免签发错误密钥。

```js
// src/licenseRegistry.js
const groups = require('../config/licenseSensorGroups.json');

const GROUP_PREFIX = '@group:';

function validateRegistry(registry) {
  if (!Array.isArray(registry) || registry.length === 0) {
    throw new Error('license registry must be a non-empty array');
  }

  const groupKeys = new Set();
  const systemKeys = new Set();

  for (const group of registry) {
    const groupKey = String(group?.key || '').trim();
    if (!groupKey || groupKeys.has(groupKey)) {
      throw new Error(`invalid or duplicate group: ${groupKey || '(empty)'}`);
    }
    if (!Array.isArray(group.items) || group.items.length === 0) {
      throw new Error(`empty group: ${groupKey}`);
    }
    groupKeys.add(groupKey);

    for (const item of group.items) {
      const systemKey = String(item?.value || '').trim();
      if (!systemKey || systemKeys.has(systemKey)) {
        throw new Error(`invalid or duplicate system: ${systemKey || '(empty)'}`);
      }
      systemKeys.add(systemKey);
    }
  }
}

validateRegistry(groups);

const groupsByKey = new Map(groups.map((group) => [group.key, group]));

function createGroupToken(groupKey) {
  if (!groupsByKey.has(groupKey)) {
    throw new Error(`unknown license group: ${groupKey}`);
  }
  return `${GROUP_PREFIX}${groupKey}`;
}

function expandLicenseScope(scope) {
  if (scope === 'all') {
    return { isAllTypes: true, groupKeys: [], sensorTypes: [] };
  }

  const entries = Array.isArray(scope) ? scope : [scope];
  const groupKeys = [];
  const sensorTypes = [];
  const seenGroups = new Set();
  const seenSystems = new Set();

  for (const entry of entries) {
    const value = String(entry || '').trim();
    if (!value) continue;

    if (value.startsWith(GROUP_PREFIX)) {
      const groupKey = value.slice(GROUP_PREFIX.length);
      const group = groupsByKey.get(groupKey);
      if (!group) throw new Error(`unknown license group: ${groupKey}`);

      if (!seenGroups.has(groupKey)) {
        seenGroups.add(groupKey);
        groupKeys.push(groupKey);
      }
      for (const item of group.items) {
        if (!seenSystems.has(item.value)) {
          seenSystems.add(item.value);
          sensorTypes.push(item.value);
        }
      }
      continue;
    }

    if (!seenSystems.has(value)) {
      seenSystems.add(value);
      sensorTypes.push(value);
    }
  }

  if (sensorTypes.length === 0) {
    throw new Error('license scope contains no display system');
  }

  return { isAllTypes: false, groupKeys, sensorTypes };
}

module.exports = {
  groups,
  createGroupToken,
  expandLicenseScope,
};
```

服务端也可以直接复用桌面端的 `licenseScopes.js`，但必须保证部署包内同时存在匹配版本的 `licenseSensorGroups.json`。

## 5. 密钥生成接口修改

### 5.1 建议请求格式

```http
POST /licenses/generate
Content-Type: application/json
```

分类全部请求：

```json
{
  "scopeType": "group",
  "groupKey": "precision",
  "days": 365,
  "category": "production"
}
```

固定系统请求：

```json
{
  "scopeType": "systems",
  "sensorTypes": ["hand0205", "humanBodyOptimized"],
  "days": 365,
  "category": "production"
}
```

### 5.2 生成逻辑

```js
const { createGroupToken, expandLicenseScope } = require('./licenseRegistry');
const { generateLicenseKey } = require('../crypto-lib.cjs');

function buildLicenseFile(body) {
  if (body.scopeType === 'all') return 'all';

  if (body.scopeType === 'group') {
    return createGroupToken(String(body.groupKey || '').trim());
  }

  if (body.scopeType === 'systems') {
    const systems = Array.isArray(body.sensorTypes) ? body.sensorTypes : [];
    const normalized = [...new Set(systems.map(String).map((v) => v.trim()).filter(Boolean))];
    expandLicenseScope(normalized);
    return normalized.length === 1 ? normalized[0] : normalized;
  }

  throw new Error('unsupported scopeType');
}

function issueLicense(body) {
  const licenseFile = buildLicenseFile(body);
  const key = generateLicenseKey(
    licenseFile,
    Number(body.days),
    body.category || 'production',
  );

  return {
    key,
    licenseFile,
    version: String(licenseFile).includes('@group:') ? 3 : 2,
    expanded: expandLicenseScope(licenseFile),
  };
}
```

分类密钥解密后的核心 payload 必须类似：

```json
{
  "date": 1790000000000,
  "file": "@group:precision",
  "cat": "production",
  "v": 3
}
```

禁止写成：

```json
{
  "file": ["hand0205", "fast1024", "humanBodyOptimized"]
}
```

后者只是固定数组，不会随着分类注册表更新而扩展。

## 6. `/licenseCheck` 修改

现有在线校验接口：

```http
POST /licenseCheck
Content-Type: application/json

{ "key": "<密钥>" }
```

服务端解密并完成状态、有效期、暂停和吊销校验后，应使用共享注册表展开 `file`：

```js
const expanded = expandLicenseScope(payload.file);

return res.json({
  time: Date.now(),
  valid: true,
  status: 'active',
  reason: null,
  expireTimestamp: Number(payload.date),
  remainingDays,
  sensorTypes: expanded.sensorTypes,
  isAllTypes: expanded.isAllTypes,
  groupKeys: expanded.groupKeys,
});
```

处理规则：

- 未知 `@group:`：返回 `valid: false`，不能当作普通系统 key。
- 分类与具体系统混合：按请求顺序展开并去重。
- `all`：保持 `isAllTypes: true`；是否返回全量 `sensorTypes` 可沿用现有接口规则。
- 旧单系统和固定数组：保持兼容。
- 过期、暂停、吊销：继续使用现有业务状态，不因分类授权绕过。

## 7. `/sensorTypes` 修改

桌面端会请求：

```http
GET /sensorTypes
```

新增系统后，该接口也必须返回新系统，否则后台动态系统名称仍会使用旧缓存或本地兜底。

响应格式：

```json
{
  "time": 1790000000000,
  "flat": [
    {
      "label": "人体全身优化",
      "value": "humanBodyOptimized",
      "group": "精密"
    }
  ],
  "map": {
    "humanBodyOptimized": "人体全身优化"
  }
}
```

约束：

- `value` 是协议字段，必须与桌面端系统 key 和分类注册表完全一致。
- `label`、`group` 只用于页面展示。
- `flat` 不能为空。
- `map[value]` 应与 `flat` 中的 label 一致。
- 接口失败时桌面端会使用本地缓存或内置清单，因此服务发布后要主动检查客户端是否拉到了新 `time`。

如果发证服务的系统名称保存在数据库中，可用注册表的 `value` 做关联，数据库只保存多语言显示名，不再保存另一份分类归属。

## 8. 新增系统的标准发布流程

假设新增系统 key 为 `newSystem`，属于精密分类：

1. 桌面端完成 `newSystem` 的后端协议、系统切换、前端渲染、采集回放、CSV 和语言资源接入。
2. 在 `E:\shroom1\licenseSensorGroups.json` 的 `precision.items` 中加入：

   ```json
   { "labelKey": "sensorNewSystem", "value": "newSystem" }
   ```

3. 运行注册表同步命令。
4. 在发证服务的名称表或数据库中加入 `newSystem` 的中文、英文、日文显示名。
5. 确认分类下拉能够选择“精密全部”。
6. 确认新签发密钥 payload 中仍是 `@group:precision`。
7. 确认 `/licenseCheck` 展开的 `sensorTypes` 包含 `newSystem`。
8. 确认 `/sensorTypes` 返回 `newSystem`。
9. 先发布发证服务，再发布新版桌面端。
10. 用一枚旧的、未过期的精密全部密钥验证新版客户端可以看到 `newSystem`。

## 9. 兼容性规则

| 密钥类型 | 新增分类成员后是否自动获得新系统 | 是否需要重发 |
| --- | --- | --- |
| `@group:precision` | 是，前提是服务端和客户端都更新注册表 | 否 |
| `["@group:precision", "jqbed"]` | 是 | 否 |
| `["hand0205", "fast1024"]` | 否 | 是 |
| `humanBodyOptimized` | 否，只授权该系统 | 视需求 |
| `all` | 是，继续保持全部授权语义 | 否 |

旧 v1/v2 单系统、数组和 `all` 密钥必须继续可用。只有包含分类令牌的密钥使用 v3。

## 10. 删除或移动系统的规则

- 从分类删除系统会让该分类密钥在新版服务和新版客户端中失去该系统，属于授权范围缩减，必须谨慎发布。
- 系统从一个分类移动到另一个分类时，旧分类密钥将失去它，新分类密钥将获得它。
- 不允许同一系统同时出现在两个分类中；注册表校验会拒绝重复 value。
- 已签发的固定数组密钥不受分类移动影响。
- 系统 key 不应直接改名；需要改名时应保留旧 key 兼容，或提供明确的密钥迁移策略。

## 11. 安全与失败处理

- 不提供由桌面客户端运行时自动上传注册表到服务器的接口；同步应由开发或 CI/CD 完成。
- 生成接口必须校验调用方身份与权限，不能只依赖前端隐藏按钮。
- `days` 必须限制为正整数并设置合理上限。
- 未知系统、未知分类、空授权范围全部拒绝。
- 服务启动时注册表校验失败应 fail-fast，不能退回空列表继续签发。
- 日志可记录 `groupKey`、系统数量和注册表 SHA-256，但不要记录完整密钥明文或加密密钥。
- AES/RSA 生成细节继续复用现有服务实现或本项目 `crypto-lib.cjs`，不要在多个文件中复制密钥常量。

## 12. 服务端验收清单

### 注册表

- [ ] 同步命令成功。
- [ ] 服务端与桌面端 SHA-256 一致。
- [ ] 重复 group key 启动失败。
- [ ] 重复 system key 启动失败。
- [ ] 空分类启动失败。

### 生成接口

- [ ] `precision` 生成的 payload 为 `file: "@group:precision"`、`v: 3`。
- [ ] 未知 group key 返回 4xx。
- [ ] 旧单系统、固定数组和 `all` 仍可生成。
- [ ] 分类与具体系统混合时顺序稳定且去重。

### 校验接口

- [ ] `/licenseCheck` 能展开分类并返回具体 `sensorTypes`。
- [ ] 未知分类密钥返回无效。
- [ ] 过期、暂停、吊销规则不变。
- [ ] 旧 v1/v2 密钥校验不回归。

### 系统清单

- [ ] `/sensorTypes` 包含新增系统。
- [ ] `flat` 和 `map` 名称一致。
- [ ] 客户端重连后收到新的清单时间和系统名称。

### 端到端

- [ ] 旧分类密钥在新版客户端中自动显示新增系统。
- [ ] 固定数组旧密钥不会越权显示新增系统。
- [ ] 切换新增系统后后端实际协议、串口和数据库系统同步切换。

## 13. 当前落地状态

桌面端仓库已经包含：

- `licenseSensorGroups.json`：共享分类注册表。
- `licenseScopes.js`：注册表校验、分类令牌创建与展开。
- `crypto-lib.cjs`：v3 分类密钥生成、在线解码和离线密钥兼容。
- `scripts/sync-license-registry.cjs`：向发证服务同步注册表并校验 SHA-256。
- `server.js` / `licenseManager.js`：分类展开、默认系统和前端授权范围下发。
- `sdk/src/license/LicenseService.js`：SDK 分类范围展开。

发证服务（`E:\key`，key-manager）已按第 4～7 节落地（2026-08-19）：

| 文档章节 | 落地位置 |
| :--- | :--- |
| §2 唯一数据源 | `config/licenseSensorGroups.json`（由 §3 同步命令写入，SHA-256 与桌面端一致） |
| §4 注册表模块 | `shared/licenseScopes.ts`（纯逻辑：校验、令牌、`expandLicenseFile`）+ `server/licenseRegistry.ts`（磁盘优先加载、fail-fast、打印 SHA-256），在 `startServer()` 最前调用 |
| §5 生成接口 | `shared/crypto.ts` 的 `generateLicenseKey`（`file` 原样存令牌，含令牌时 `v: 3`）、`buildLicenseFile`/`normalizeLicenseFile`；`server/routers.ts` 四处生成入口与 `server/keyGenerationRequestApproval.ts` 统一校验授权范围 |
| §6 `/licenseCheck` | `server/_core/index.ts`，返回 `sensorTypes`（已展开）、`isAllTypes`、`groupKeys`、`scope`；未知分类判 `valid: false`；过期/暂停/吊销/防回拨逻辑未改动 |
| §7 `/sensorTypes` | 同文件，每组带 `groupKey`，新增 `licenseGroups` 与 `registrySha256`；DB 异常时回退为注册表派生清单（`flat` 不为空）。另新增 tRPC `sensors.licenseGroups` 供后台界面使用 |
| §9 兼容性 | v1/v2 密钥继续可解，`server/crypto.test.ts` 用固定密文常量做回归锚点 |
| §11 安全 | 日志只记录分类数/系统数/SHA-256，不打印密钥明文；未知系统、未知分类、空范围一律 4xx；注册表非法则终止启动；不提供客户端上传注册表的接口 |

配套：后台生成密钥页与离线密钥页支持勾选「整个分类（随分类更新）」，各列表/验证页把 `@group:precision` 显示为「精密全部」；`shared/crypto-lib.cjs` 同步支持 v3，并由 `server/cryptoLibParity.test.ts` 锁住与 TS 版的一致性；文档见 `ARCHITECTURE.md` §7.4 与 `DEPLOY.md` §3.4。

第 12 节验收清单中的自动化部分由 `server/licenseScopes.test.ts`、`server/crypto.test.ts`、`server/cryptoLibParity.test.ts` 覆盖（共 115 个用例通过）；注册表 fail-fast、`/licenseCheck` 与端到端项需在部署后按第 12 节人工核对。

线上 `shroom.jq-industries.com` 若是另一套服务代码，仍需按本文档第 4～7 节各自落地。
