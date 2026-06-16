-- 阶段二：心跳校验 + 离线黑名单
-- 阶段三：合同管理 + 团队管理 + 告警

-- ===== 设备心跳表 =====
CREATE TABLE IF NOT EXISTS `deviceHeartbeats` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `keyId` int NOT NULL,
  `keyType` enum('online','offline') NOT NULL DEFAULT 'online',
  `deviceCode` varchar(256) NOT NULL,
  `lastHeartbeatAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `heartbeatCount` int NOT NULL DEFAULT 1,
  `clientIp` varchar(64),
  `clientVersion` varchar(64),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_key_device` (`keyId`, `keyType`, `deviceCode`)
);

-- ===== 离线密钥黑名单表 =====
CREATE TABLE IF NOT EXISTS `offlineBlacklist` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `machineId` varchar(32) NOT NULL COMMENT '被吊销的机器码',
  `offlineKeyId` int COMMENT '关联的离线密钥 ID',
  `reason` text COMMENT '加入黑名单原因',
  `addedById` int NOT NULL,
  `addedByName` varchar(128),
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_machine` (`machineId`),
  INDEX `idx_offline_key` (`offlineKeyId`)
);

-- ===== 合同表 =====
CREATE TABLE IF NOT EXISTS `contracts` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `contractNo` varchar(128) NOT NULL COMMENT '合同编号',
  `title` varchar(256) NOT NULL COMMENT '合同标题',
  `customerId` int COMMENT '关联客户 ID',
  `customerName` varchar(256) COMMENT '客户名称',
  `signDate` date COMMENT '签订日期',
  `startDate` date COMMENT '生效日期',
  `endDate` date COMMENT '结束日期',
  `totalKeys` int NOT NULL DEFAULT 0 COMMENT '合同约定密钥总数',
  `usedKeys` int NOT NULL DEFAULT 0 COMMENT '已使用密钥数',
  `status` enum('DRAFT','ACTIVE','EXPIRED','TERMINATED') NOT NULL DEFAULT 'DRAFT',
  `remark` text,
  `createdById` int NOT NULL,
  `createdByName` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_contract_no` (`contractNo`)
);

-- ===== 团队表 =====
CREATE TABLE IF NOT EXISTS `teams` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `name` varchar(128) NOT NULL COMMENT '团队名称',
  `description` text COMMENT '团队描述',
  `leaderId` int COMMENT '团队负责人 ID',
  `leaderName` varchar(128) COMMENT '负责人名称',
  `parentTeamId` int COMMENT '上级团队 ID（支持多级）',
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ===== 用户表增加团队关联 =====
ALTER TABLE `users` ADD COLUMN `teamId` int AFTER `createdById`;

-- ===== 密钥表增加合同关联 =====
ALTER TABLE `licenseKeys` ADD COLUMN `contractId` int AFTER `customerId`;
ALTER TABLE `licenseKeys` ADD COLUMN `contractNo` varchar(128) AFTER `contractId`;

-- ===== 离线密钥表增加合同关联 =====
ALTER TABLE `offlineKeys` ADD COLUMN `contractId` int AFTER `customerId`;
ALTER TABLE `offlineKeys` ADD COLUMN `contractNo` varchar(128) AFTER `contractId`;

-- ===== 告警规则表 =====
CREATE TABLE IF NOT EXISTS `alertRules` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `name` varchar(128) NOT NULL COMMENT '规则名称',
  `type` enum('EXPIRY_WARNING','HEARTBEAT_LOST','QUOTA_EXCEEDED','CONTRACT_EXPIRY') NOT NULL,
  `config` text NOT NULL COMMENT '规则配置 JSON（如 daysBeforeExpiry: 7）',
  `isActive` boolean NOT NULL DEFAULT true,
  `createdById` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ===== 告警记录表 =====
CREATE TABLE IF NOT EXISTS `alerts` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `ruleId` int COMMENT '触发的规则 ID',
  `type` enum('EXPIRY_WARNING','HEARTBEAT_LOST','QUOTA_EXCEEDED','CONTRACT_EXPIRY') NOT NULL,
  `level` enum('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'WARNING',
  `title` varchar(256) NOT NULL,
  `content` text,
  `resourceType` varchar(64) COMMENT '关联资源类型',
  `resourceId` int COMMENT '关联资源 ID',
  `isRead` boolean NOT NULL DEFAULT false,
  `isResolved` boolean NOT NULL DEFAULT false,
  `resolvedAt` timestamp NULL,
  `resolvedById` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ===== 审批流表 =====
CREATE TABLE IF NOT EXISTS `approvals` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `type` enum('REVOKE','BATCH_GENERATE','DELETE','SUSPEND') NOT NULL COMMENT '审批类型',
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `requesterId` int NOT NULL,
  `requesterName` varchar(128),
  `approverId` int,
  `approverName` varchar(128),
  `resourceType` varchar(64) NOT NULL,
  `resourceId` int,
  `requestData` text COMMENT '请求数据 JSON',
  `reason` text COMMENT '申请原因',
  `rejectReason` text COMMENT '拒绝原因',
  `requestedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolvedAt` timestamp NULL
);
