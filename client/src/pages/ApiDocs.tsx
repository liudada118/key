import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Lock,
  Monitor,
  Search,
  Server,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useState } from "react";

// ===== 类型定义 =====
type ParamField = {
  name: string;
  type: string;
  required: boolean;
  desc: string;
  default?: string;
};

type ResponseField = {
  name: string;
  type: string;
  desc: string;
};

type ApiEndpoint = {
  name: string;
  method: "query" | "mutation";
  auth: "public" | "protected" | "admin" | "superAdmin";
  desc: string;
  params?: ParamField[];
  response?: ResponseField[];
  responseExample?: string;
  notes?: string;
};

type ApiGroup = {
  title: string;
  desc: string;
  endpoints: ApiEndpoint[];
};

// ===== 客户端接口数据 =====
const clientApiGroups: ApiGroup[] = [
  {
    title: "密钥激活与绑定",
    desc: "客户端通过密钥+设备码完成自助激活绑定",
    endpoints: [
      {
        name: "keys.activate",
        method: "mutation",
        auth: "public",
        desc: "客户自助激活 -- 将设备码绑定到密钥",
        params: [
          { name: "keyString", type: "string", required: true, desc: "密钥字符串（由管理员提供）" },
          { name: "deviceCode", type: "string", required: true, desc: "设备码（如 MAC 地址、机器码等）" },
          { name: "deviceName", type: "string", required: false, desc: "设备名称/备注（可选）" },
        ],
        response: [
          { name: "success", type: "boolean", desc: "是否成功" },
          { name: "message", type: "string", desc: "结果消息" },
          { name: "currentDevices", type: "number", desc: "当前已绑定设备数" },
          { name: "maxDevices", type: "number", desc: "最大设备数" },
          { name: "alreadyBound", type: "boolean", desc: "是否已经绑定过（重复激活时）" },
          { name: "error", type: "string", desc: "错误信息（失败时）" },
        ],
        responseExample: `// 绑定成功
{
  "success": true,
  "message": "设备绑定成功",
  "currentDevices": 2,
  "maxDevices": 3
}

// 已绑定（重复激活）
{
  "success": true,
  "message": "该设备已绑定此密钥，无需重复激活",
  "alreadyBound": true
}

// 达到设备上限
{
  "success": false,
  "error": "设备绑定数量已达上限（3台）",
  "currentDevices": 3,
  "maxDevices": 3
}

// 密钥已过期
{
  "success": false,
  "error": "密钥已过期"
}`,
        notes: "公开接口，无需登录。客户端首次启动时调用此接口完成激活。系统自动记录绑定 IP 地址。",
      },
    ],
  },
  {
    title: "密钥验证",
    desc: "客户端验证密钥有效性和设备授权状态",
    endpoints: [
      {
        name: "keys.verifyOnDevice",
        method: "mutation",
        auth: "public",
        desc: "验证密钥在指定设备上是否有效",
        params: [
          { name: "keyString", type: "string", required: true, desc: "密钥字符串" },
          { name: "deviceCode", type: "string", required: true, desc: "当前设备码" },
        ],
        response: [
          { name: "valid", type: "boolean", desc: "是否有效（密钥有效且设备已绑定）" },
          { name: "error", type: "string", desc: "错误原因（无效时）" },
          { name: "expired", type: "boolean", desc: "密钥是否已过期" },
          { name: "notBound", type: "boolean", desc: "设备是否未绑定" },
          { name: "canBind", type: "boolean", desc: "是否还可以绑定新设备（未达上限）" },
        ],
        responseExample: `// 验证通过
{ "valid": true }

// 设备未绑定，但还可以绑定
{
  "valid": false,
  "error": "该设备未绑定此密钥",
  "notBound": true,
  "canBind": true
}

// 设备未绑定，且已达设备上限
{
  "valid": false,
  "error": "该设备未绑定此密钥，且设备数已达上限",
  "notBound": true,
  "canBind": false
}

// 密钥已过期
{
  "valid": false,
  "error": "密钥已过期",
  "expired": true
}

// 密钥无效
{
  "valid": false,
  "error": "密钥无效或不存在"
}`,
        notes: "公开接口。建议客户端每次启动时调用此接口验证授权状态。",
      },
      {
        name: "keys.verify",
        method: "mutation",
        auth: "public",
        desc: "解密并查询密钥完整信息（含设备绑定列表）",
        params: [
          { name: "keyString", type: "string", required: true, desc: "密钥字符串" },
          { name: "deviceCode", type: "string", required: false, desc: "设备码（可选，检查是否已绑定）" },
        ],
        response: [
          { name: "valid", type: "boolean", desc: "密钥是否有效" },
          { name: "sensorType", type: "string", desc: "授权的传感器类型（逗号分隔）" },
          { name: "expireDate", type: "number", desc: "到期时间戳（毫秒）" },
          { name: "category", type: "string", desc: "密钥类型：production / rental" },
          { name: "isActivated", type: "boolean", desc: "是否已激活" },
          { name: "maxDevices", type: "number", desc: "最大可绑定设备数" },
          { name: "deviceCount", type: "number", desc: "已绑定设备数" },
          { name: "devices", type: "array", desc: "已绑定设备列表" },
          { name: "deviceBound", type: "boolean", desc: "指定设备码是否已绑定" },
        ],
        responseExample: `{
  "valid": true,
  "sensorType": "hand0205,car_seat",
  "expireDate": 1743465600000,
  "category": "rental",
  "isActivated": true,
  "maxDevices": 3,
  "deviceCount": 2,
  "devices": [
    { "id": 1, "deviceCode": "AA:BB:CC:DD:EE:FF", "deviceName": null, "boundAt": "2026-03-10T08:00:00.000Z" },
    { "id": 2, "deviceCode": "11:22:33:44:55:66", "deviceName": "工位2", "boundAt": "2026-03-12T10:30:00.000Z" }
  ],
  "deviceBound": false
}`,
      },
    ],
  },
  {
    title: "离线密钥验证",
    desc: "获取 RSA 公钥用于离线激活码验证",
    endpoints: [
      {
        name: "offlineKeys.publicKey",
        method: "query",
        auth: "public",
        desc: "获取当前活跃的 RSA 公钥",
        response: [
          { name: "publicKey", type: "string", desc: "PEM 格式公钥" },
          { name: "keySize", type: "number", desc: "密钥位数" },
          { name: "name", type: "string", desc: "密钥对名称" },
        ],
        responseExample: `{
  "publicKey": "-----BEGIN PUBLIC KEY-----\\nMIIBIjANBgkqhki...\\n-----END PUBLIC KEY-----",
  "keySize": 2048,
  "name": "default"
}`,
        notes: "客户端下载此公钥后，用于本地验证离线激活码的 RSA-SHA256 签名。",
      },
    ],
  },
  {
    title: "传感器类型查询",
    desc: "获取系统支持的传感器类型列表",
    endpoints: [
      {
        name: "sensors.groups",
        method: "query",
        auth: "public",
        desc: "获取分组传感器类型列表（仅启用的）",
        responseExample: `[
  {
    "groupName": "触觉手套",
    "groupIcon": "🖐",
    "items": [
      { "id": 1, "value": "hand0205", "label": "触觉手套" }
    ]
  },
  {
    "groupName": "汽车座椅",
    "groupIcon": "🚗",
    "items": [
      { "id": 2, "value": "car_seat", "label": "汽车座椅" }
    ]
  }
]`,
      },
      {
        name: "sensors.groupNames",
        method: "query",
        auth: "public",
        desc: "获取所有分组名称列表",
        responseExample: `["触觉手套", "汽车座椅", "其他"]`,
      },
    ],
  },
];

// ===== 管理系统接口数据 =====
const adminApiGroups: ApiGroup[] = [
  {
    title: "认证 (auth)",
    desc: "用户登录、登出和密码管理",
    endpoints: [
      {
        name: "auth.me",
        method: "query",
        auth: "public",
        desc: "获取当前登录用户信息",
        response: [
          { name: "id", type: "number", desc: "用户 ID" },
          { name: "username", type: "string", desc: "用户名" },
          { name: "name", type: "string", desc: "显示名称" },
          { name: "role", type: "enum", desc: "角色：super_admin / admin / user" },
          { name: "isActive", type: "boolean", desc: "账号是否启用" },
        ],
        responseExample: `{
  "id": 1,
  "username": "admin",
  "name": "超级管理员",
  "role": "super_admin",
  "isActive": true,
  "createdAt": "2026-03-06T10:00:00.000Z"
}`,
        notes: "未登录时返回 null",
      },
      {
        name: "auth.logout",
        method: "mutation",
        auth: "public",
        desc: "用户登出，清除 Session Cookie",
        response: [{ name: "success", type: "boolean", desc: "是否成功" }],
        responseExample: `{ "success": true }`,
      },
      {
        name: "auth.changePassword",
        method: "mutation",
        auth: "protected",
        desc: "修改当前用户的密码",
        params: [
          { name: "oldPassword", type: "string", required: true, desc: "旧密码" },
          { name: "newPassword", type: "string", required: true, desc: "新密码（至少6位）" },
        ],
        response: [{ name: "success", type: "boolean", desc: "是否成功" }],
      },
    ],
  },
  {
    title: "在线密钥管理 (keys)",
    desc: "密钥的生成、查询、导出和设备管理",
    endpoints: [
      {
        name: "keys.categories",
        method: "query",
        auth: "public",
        desc: "获取密钥类型列表",
        responseExample: `[
  { "value": "production", "label": "量产密钥" },
  { "value": "rental", "label": "在线租赁密钥" }
]`,
      },
      {
        name: "keys.generate",
        method: "mutation",
        auth: "protected",
        desc: "生成单个在线密钥",
        params: [
          { name: "sensorTypes", type: "string | string[]", required: true, desc: "传感器类型标识符，单个字符串或数组" },
          { name: "days", type: "number", required: true, desc: "有效期天数（1-36500）" },
          { name: "category", type: "enum", required: true, desc: "密钥类型：production / rental" },
          { name: "maxDevices", type: "number", required: false, desc: "最大可绑定设备数（0=不限）", default: "1" },
          { name: "customerId", type: "number", required: false, desc: "关联客户 ID" },
          { name: "customerName", type: "string", required: false, desc: "客户名称" },
          { name: "remark", type: "string", required: false, desc: "备注" },
        ],
        response: [
          { name: "keyString", type: "string", desc: "生成的密钥字符串（hex 编码）" },
          { name: "expireTimestamp", type: "number", desc: "到期时间戳（毫秒）" },
          { name: "maxDevices", type: "number", desc: "最大设备数" },
        ],
        responseExample: `{
  "keyString": "a1b2c3d4e5f6...（hex 密钥）",
  "expireTimestamp": 1743465600000,
  "maxDevices": 3
}`,
      },
      {
        name: "keys.batchGenerate",
        method: "mutation",
        auth: "protected",
        desc: "批量生成在线密钥",
        params: [
          { name: "sensorTypes", type: "string | string[]", required: true, desc: "传感器类型" },
          { name: "days", type: "number", required: true, desc: "有效期天数（1-36500）" },
          { name: "category", type: "enum", required: true, desc: "密钥类型：production / rental" },
          { name: "count", type: "number", required: true, desc: "生成数量（1-500）" },
          { name: "maxDevices", type: "number", required: false, desc: "最大可绑定设备数（0=不限）", default: "1" },
          { name: "customerId", type: "number", required: false, desc: "关联客户 ID" },
          { name: "customerName", type: "string", required: false, desc: "客户名称" },
          { name: "remark", type: "string", required: false, desc: "备注" },
        ],
        response: [
          { name: "batchId", type: "string", desc: "批次号" },
          { name: "keys", type: "array", desc: "密钥数组 [{keyString, expireTimestamp}]" },
          { name: "count", type: "number", desc: "实际生成数量" },
        ],
      },
      {
        name: "keys.list",
        method: "query",
        auth: "protected",
        desc: "分页查询密钥列表（自动按权限过滤）",
        params: [
          { name: "page", type: "number", required: false, desc: "页码", default: "1" },
          { name: "pageSize", type: "number", required: false, desc: "每页数量（1-100）", default: "20" },
          { name: "category", type: "string", required: false, desc: "按密钥类型筛选" },
          { name: "sensorType", type: "string", required: false, desc: "按传感器类型筛选" },
          { name: "isActivated", type: "boolean", required: false, desc: "按激活状态筛选" },
          { name: "search", type: "string", required: false, desc: "搜索关键词（密钥/创建者/客户）" },
          { name: "customerId", type: "number", required: false, desc: "按客户 ID 筛选" },
        ],
        response: [
          { name: "items", type: "array", desc: "密钥记录数组" },
          { name: "total", type: "number", desc: "总记录数" },
          { name: "page", type: "number", desc: "当前页码" },
          { name: "pageSize", type: "number", desc: "每页数量" },
        ],
        notes: "超级管理员查看所有；管理员查看自己及下属的；子账号仅查看自己的",
      },
      {
        name: "keys.stats",
        method: "query",
        auth: "protected",
        desc: "获取密钥统计数据",
        response: [
          { name: "total", type: "number", desc: "密钥总数" },
          { name: "activated", type: "number", desc: "已激活数" },
          { name: "production", type: "number", desc: "量产密钥数" },
          { name: "rental", type: "number", desc: "租赁密钥数" },
        ],
      },
      {
        name: "keys.devices",
        method: "query",
        auth: "protected",
        desc: "获取密钥已绑定的设备列表",
        params: [
          { name: "keyId", type: "number", required: true, desc: "密钥 ID" },
        ],
        response: [
          { name: "id", type: "number", desc: "设备记录 ID" },
          { name: "keyId", type: "number", desc: "密钥 ID" },
          { name: "deviceCode", type: "string", desc: "设备码" },
          { name: "deviceName", type: "string | null", desc: "设备名称" },
          { name: "boundAt", type: "string", desc: "绑定时间" },
          { name: "boundIp", type: "string | null", desc: "绑定时 IP" },
        ],
      },
      {
        name: "keys.unbindDevice",
        method: "mutation",
        auth: "admin",
        desc: "解绑设备（管理员操作）",
        params: [
          { name: "keyId", type: "number", required: true, desc: "密钥 ID" },
          { name: "deviceId", type: "number", required: true, desc: "设备记录 ID" },
        ],
        response: [
          { name: "success", type: "boolean", desc: "是否成功" },
          { name: "remainingDevices", type: "number", desc: "剩余绑定设备数" },
        ],
        notes: "如果所有设备都被解绑，密钥状态会重置为【未激活】",
      },
      {
        name: "keys.changeCategory",
        method: "mutation",
        auth: "superAdmin",
        desc: "更改密钥类型（量产/租赁互转）",
        params: [
          { name: "keyId", type: "number", required: true, desc: "密钥 ID" },
          { name: "category", type: "enum", required: true, desc: "新类型：production / rental" },
        ],
        response: [
          { name: "success", type: "boolean", desc: "是否成功" },
          { name: "key", type: "object", desc: "更新后的密钥记录" },
        ],
      },
      {
        name: "keys.export",
        method: "mutation",
        auth: "protected",
        desc: "导出密钥数据（CSV 或 JSON 格式）",
        params: [
          { name: "format", type: "enum", required: true, desc: "导出格式：csv / json" },
          { name: "category", type: "string", required: false, desc: "按密钥类型筛选" },
          { name: "sensorType", type: "string", required: false, desc: "按传感器类型筛选" },
          { name: "isActivated", type: "boolean", required: false, desc: "按激活状态筛选" },
          { name: "customerId", type: "number", required: false, desc: "按客户 ID 筛选" },
        ],
      },
    ],
  },
  {
    title: "离线密钥管理 (offlineKeys)",
    desc: "离线密钥生成、查询和 RSA 密钥对管理",
    endpoints: [
      {
        name: "offlineKeys.generate",
        method: "mutation",
        auth: "protected",
        desc: "生成离线激活码（RSA-SHA256 签名）",
        params: [
          { name: "machineId", type: "string", required: true, desc: "机器码（16位十六进制）" },
          { name: "sensorTypes", type: '"all" | string[]', required: true, desc: '传感器类型："all" 或类型数组' },
          { name: "days", type: "number", required: true, desc: "有效期天数（1-36500）" },
          { name: "customerId", type: "number", required: false, desc: "关联客户 ID" },
          { name: "customerName", type: "string", required: false, desc: "客户名称" },
          { name: "remark", type: "string", required: false, desc: "备注" },
        ],
        response: [
          { name: "activationCode", type: "string", desc: "Base64 编码的激活码" },
          { name: "machineId", type: "string", desc: "机器码" },
          { name: "expireDate", type: "number", desc: "到期时间戳" },
        ],
        notes: "机器码会自动转为大写。激活码由 RSA 私钥签名，客户端使用公钥验证。",
      },
      {
        name: "offlineKeys.list",
        method: "query",
        auth: "protected",
        desc: "分页查询离线密钥列表",
        params: [
          { name: "page", type: "number", required: false, desc: "页码", default: "1" },
          { name: "pageSize", type: "number", required: false, desc: "每页数量", default: "20" },
          { name: "search", type: "string", required: false, desc: "搜索关键词" },
          { name: "machineId", type: "string", required: false, desc: "按机器码筛选" },
        ],
      },
      {
        name: "offlineKeys.stats",
        method: "query",
        auth: "protected",
        desc: "获取离线密钥统计数据",
      },
      {
        name: "offlineKeys.rsaKeyPairs",
        method: "query",
        auth: "superAdmin",
        desc: "获取所有 RSA 密钥对列表",
      },
      {
        name: "offlineKeys.generateRsaKeyPair",
        method: "mutation",
        auth: "superAdmin",
        desc: "生成新的 RSA 密钥对",
        params: [
          { name: "name", type: "string", required: false, desc: "密钥对名称", default: "default" },
          { name: "keySize", type: "number", required: false, desc: "密钥位数（2048-4096）", default: "2048" },
        ],
      },
    ],
  },
  {
    title: "账号管理 (accounts)",
    desc: "三级权限体系下的账号 CRUD",
    endpoints: [
      {
        name: "accounts.list",
        method: "query",
        auth: "protected",
        desc: "获取下级账号列表",
        notes: "超级管理员看到所有管理员和子账号；管理员看到自己创建的子账号",
      },
      {
        name: "accounts.all",
        method: "query",
        auth: "superAdmin",
        desc: "获取所有用户列表",
      },
      {
        name: "accounts.create",
        method: "mutation",
        auth: "admin",
        desc: "创建下级账号",
        params: [
          { name: "username", type: "string", required: true, desc: "用户名（2-32字符）" },
          { name: "password", type: "string", required: true, desc: "密码（至少6位）" },
          { name: "name", type: "string", required: true, desc: "显示名称" },
          { name: "role", type: "enum", required: true, desc: "角色：admin / user" },
          { name: "remark", type: "string", required: false, desc: "备注" },
        ],
        notes: "管理员只能创建 user 角色；超级管理员可创建 admin 和 user",
      },
      {
        name: "accounts.update",
        method: "mutation",
        auth: "admin",
        desc: "编辑账号信息",
        params: [
          { name: "id", type: "number", required: true, desc: "账号 ID" },
          { name: "name", type: "string", required: false, desc: "显示名称" },
          { name: "isActive", type: "boolean", required: false, desc: "是否启用" },
          { name: "remark", type: "string", required: false, desc: "备注" },
        ],
      },
      {
        name: "accounts.resetPassword",
        method: "mutation",
        auth: "admin",
        desc: "重置下级账号密码",
        params: [
          { name: "id", type: "number", required: true, desc: "账号 ID" },
          { name: "newPassword", type: "string", required: true, desc: "新密码（至少6位）" },
        ],
      },
    ],
  },
  {
    title: "客户管理 (customers)",
    desc: "客户信息的增删改查",
    endpoints: [
      {
        name: "customers.list",
        method: "query",
        auth: "protected",
        desc: "分页查询客户列表",
        params: [
          { name: "page", type: "number", required: false, desc: "页码", default: "1" },
          { name: "pageSize", type: "number", required: false, desc: "每页数量", default: "20" },
          { name: "search", type: "string", required: false, desc: "搜索关键词" },
          { name: "isActive", type: "boolean", required: false, desc: "按启用状态筛选" },
        ],
      },
      {
        name: "customers.all",
        method: "query",
        auth: "protected",
        desc: "获取全量客户列表（用于下拉选择）",
      },
      {
        name: "customers.get",
        method: "query",
        auth: "protected",
        desc: "获取单个客户详情（含密钥数量）",
        params: [
          { name: "id", type: "number", required: true, desc: "客户 ID" },
        ],
      },
      {
        name: "customers.create",
        method: "mutation",
        auth: "protected",
        desc: "创建客户",
        params: [
          { name: "name", type: "string", required: true, desc: "客户名称/公司名" },
          { name: "contactPerson", type: "string", required: false, desc: "联系人" },
          { name: "phone", type: "string", required: false, desc: "联系电话" },
          { name: "email", type: "string", required: false, desc: "邮箱" },
          { name: "address", type: "string", required: false, desc: "地址" },
          { name: "remark", type: "string", required: false, desc: "备注" },
        ],
      },
      {
        name: "customers.update",
        method: "mutation",
        auth: "protected",
        desc: "更新客户信息",
        params: [
          { name: "id", type: "number", required: true, desc: "客户 ID" },
          { name: "name", type: "string", required: false, desc: "客户名称" },
          { name: "contactPerson", type: "string", required: false, desc: "联系人" },
          { name: "phone", type: "string", required: false, desc: "联系电话" },
          { name: "email", type: "string", required: false, desc: "邮箱" },
          { name: "address", type: "string", required: false, desc: "地址" },
          { name: "remark", type: "string", required: false, desc: "备注" },
          { name: "isActive", type: "boolean", required: false, desc: "是否启用" },
        ],
      },
    ],
  },
  {
    title: "传感器类型管理 (sensors)",
    desc: "传感器类型的分组管理（超级管理员）",
    endpoints: [
      {
        name: "sensors.all",
        method: "query",
        auth: "superAdmin",
        desc: "获取所有传感器类型（包括禁用的）",
      },
      {
        name: "sensors.add",
        method: "mutation",
        auth: "superAdmin",
        desc: "添加传感器类型",
        params: [
          { name: "label", type: "string", required: true, desc: "显示名称" },
          { name: "value", type: "string", required: true, desc: "标识符（英文+数字+下划线）" },
          { name: "groupName", type: "string", required: true, desc: "分组名称" },
          { name: "groupIcon", type: "string", required: false, desc: "分组图标（emoji）" },
        ],
      },
      {
        name: "sensors.update",
        method: "mutation",
        auth: "superAdmin",
        desc: "更新传感器类型",
        params: [
          { name: "id", type: "number", required: true, desc: "传感器类型 ID" },
          { name: "label", type: "string", required: false, desc: "显示名称" },
          { name: "groupName", type: "string", required: false, desc: "分组名称" },
          { name: "groupIcon", type: "string", required: false, desc: "分组图标" },
          { name: "sortOrder", type: "number", required: false, desc: "排序顺序" },
        ],
      },
      {
        name: "sensors.delete",
        method: "mutation",
        auth: "superAdmin",
        desc: "删除传感器类型（软删除）",
        params: [
          { name: "id", type: "number", required: true, desc: "传感器类型 ID" },
        ],
      },
      {
        name: "sensors.restore",
        method: "mutation",
        auth: "superAdmin",
        desc: "恢复已删除的传感器类型",
        params: [
          { name: "id", type: "number", required: true, desc: "传感器类型 ID" },
        ],
      },
    ],
  },
];

// ===== 权限标签组件 =====
const authLabels: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  public: { label: "公开", color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: Globe },
  protected: { label: "登录", color: "bg-blue-100 text-blue-700 border-blue-200", icon: Lock },
  admin: { label: "管理员+", color: "bg-amber-100 text-amber-700 border-amber-200", icon: Shield },
  superAdmin: { label: "超级管理员", color: "bg-red-100 text-red-700 border-red-200", icon: ShieldAlert },
};

function AuthBadge({ auth }: { auth: string }) {
  const config = authLabels[auth] || authLabels.protected;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.color} text-[11px] gap-1 px-2 py-0.5 font-medium`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function MethodBadge({ method }: { method: "query" | "mutation" }) {
  return (
    <Badge
      variant="outline"
      className={`text-[11px] px-2 py-0.5 font-mono font-medium ${
        method === "query"
          ? "bg-sky-100 text-sky-700 border-sky-200"
          : "bg-violet-100 text-violet-700 border-violet-200"
      }`}
    >
      {method === "query" ? "GET" : "POST"}
    </Badge>
  );
}

// ===== 单个端点组件 =====
function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors rounded-lg text-left group">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <MethodBadge method={endpoint.method} />
          <code className="text-sm font-semibold text-foreground">{endpoint.name}</code>
          <AuthBadge auth={endpoint.auth} />
          <span className="text-sm text-muted-foreground ml-auto truncate max-w-[40%] text-right">
            {endpoint.desc}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-8 mr-4 mb-4 space-y-4 border-l-2 border-primary/20 pl-4">
          <p className="text-sm text-muted-foreground">{endpoint.desc}</p>

          {endpoint.params && endpoint.params.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                请求参数
              </h4>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">参数名</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">类型</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">必填</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">默认值</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoint.params.map((p) => (
                      <tr key={p.name} className="border-b last:border-b-0">
                        <td className="px-3 py-2">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{p.name}</code>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{p.type}</td>
                        <td className="px-3 py-2">
                          {p.required ? (
                            <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">
                              必填
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">可选</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                          {p.default || "-"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{p.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {endpoint.response && endpoint.response.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                响应字段
              </h4>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">字段名</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">类型</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endpoint.response.map((r) => (
                      <tr key={r.name} className="border-b last:border-b-0">
                        <td className="px-3 py-2">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{r.name}</code>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{r.type}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {endpoint.responseExample && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                响应示例
              </h4>
              <pre className="bg-slate-950 text-slate-50 rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed">
                {endpoint.responseExample}
              </pre>
            </div>
          )}

          {endpoint.notes && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="text-amber-600 text-xs font-medium shrink-0 mt-0.5">注意：</span>
              <span className="text-xs text-amber-700">{endpoint.notes}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ===== 接口分组渲染 =====
function ApiGroupList({
  groups,
  searchQuery,
}: {
  groups: ApiGroup[];
  searchQuery: string;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(groups.map((g) => g.title))
  );

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        endpoints: group.endpoints.filter(
          (ep) =>
            ep.name.toLowerCase().includes(q) ||
            ep.desc.toLowerCase().includes(q) ||
            ep.params?.some(
              (p) => p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)
            )
        ),
      }))
      .filter((g) => g.endpoints.length > 0);
  }, [searchQuery, groups]);

  if (filteredGroups.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Search className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p>未找到匹配的接口</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filteredGroups.map((group) => (
        <Card key={group.title}>
          <CardHeader
            className="cursor-pointer select-none pb-3"
            onClick={() => toggleGroup(group.title)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {expandedGroups.has(group.title) ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <div>
                  <CardTitle className="text-base">{group.title}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">{group.desc}</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">
                {group.endpoints.length} 个接口
              </Badge>
            </div>
          </CardHeader>
          {expandedGroups.has(group.title) && (
            <CardContent className="pt-0 space-y-1">
              {group.endpoints.map((ep) => (
                <EndpointCard key={ep.name} endpoint={ep} />
              ))}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

// ===== 主页面 =====
export default function ApiDocs() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("client");

  const clientEndpointCount = clientApiGroups.reduce((sum, g) => sum + g.endpoints.length, 0);
  const adminEndpointCount = adminApiGroups.reduce((sum, g) => sum + g.endpoints.length, 0);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* 页头 */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">API 接口文档</h1>
            <p className="text-sm text-muted-foreground">
              密钥管理系统 tRPC 接口参考
            </p>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 h-12">
          <TabsTrigger value="client" className="gap-2 text-sm h-10">
            <Monitor className="h-4 w-4" />
            客户端接口
            <Badge variant="secondary" className="text-[10px] px-1.5 ml-1">
              {clientEndpointCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="admin" className="gap-2 text-sm h-10">
            <Server className="h-4 w-4" />
            管理系统接口
            <Badge variant="secondary" className="text-[10px] px-1.5 ml-1">
              {adminEndpointCount}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* 调用说明 */}
        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {activeTab === "client" ? "客户端调用说明" : "管理系统调用说明"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeTab === "client" ? (
              <>
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>
                    客户端接口均为<strong className="text-emerald-600">公开接口</strong>，无需登录即可调用。客户端软件通过 HTTP 请求直接调用。
                  </p>
                  <p>
                    <strong>典型使用流程：</strong>管理员生成密钥 &rarr; 发送给客户 &rarr; 客户端调用 <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">activate</code> 绑定设备 &rarr; 每次启动调用 <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">verifyOnDevice</code> 验证授权
                  </p>
                </div>
                <pre className="bg-slate-950 text-slate-50 rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed">{`# 1. 激活绑定设备
POST /api/trpc/keys.activate
Content-Type: application/json
{
  "json": {
    "keyString": "a1b2c3d4e5f6...",
    "deviceCode": "AA:BB:CC:DD:EE:FF",
    "deviceName": "工位1"
  }
}

# 2. 验证设备授权（每次启动时调用）
POST /api/trpc/keys.verifyOnDevice
Content-Type: application/json
{
  "json": {
    "keyString": "a1b2c3d4e5f6...",
    "deviceCode": "AA:BB:CC:DD:EE:FF"
  }
}

# 3. 获取 RSA 公钥（离线密钥验证）
GET /api/trpc/offlineKeys.publicKey

# 4. 获取传感器类型列表
GET /api/trpc/sensors.groups`}</pre>
              </>
            ) : (
              <>
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>
                    管理系统接口需要<strong className="text-blue-600">登录认证</strong>，通过 Session Cookie 鉴权。部分接口需要管理员或超级管理员权限。
                  </p>
                  <p>
                    <strong>前端调用：</strong>使用 <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">trpc.&lt;name&gt;.useQuery()</code> 或{" "}
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">trpc.&lt;name&gt;.useMutation()</code>
                  </p>
                </div>
                <pre className="bg-slate-950 text-slate-50 rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed">{`# Query 请求（GET）
GET /api/trpc/keys.list?input={"json":{"page":1,"pageSize":20}}
Cookie: session=<token>

# Mutation 请求（POST）
POST /api/trpc/keys.generate
Cookie: session=<token>
Content-Type: application/json
{
  "json": {
    "sensorTypes": ["hand0205"],
    "days": 365,
    "category": "rental",
    "maxDevices": 3
  }
}`}</pre>
              </>
            )}
          </CardContent>
        </Card>

        {/* 搜索 */}
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索接口名称、描述或参数..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* 客户端接口 */}
        <TabsContent value="client" className="mt-4">
          <ApiGroupList groups={clientApiGroups} searchQuery={searchQuery} />
        </TabsContent>

        {/* 管理系统接口 */}
        <TabsContent value="admin" className="mt-4">
          <ApiGroupList groups={adminApiGroups} searchQuery={searchQuery} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
