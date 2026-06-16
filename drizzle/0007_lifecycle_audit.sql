-- Migration 0007: 生命周期状态 + 审计日志 + 状态历史
-- 阶段一核心改动

-- 1. licenseKeys 表增加生命周期相关字段
ALTER TABLE `licenseKeys`
  ADD COLUMN `keyHash` varchar(64) AFTER `keyString`,
  ADD COLUMN `status` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED') NOT NULL DEFAULT 'ISSUED' AFTER `isActivated`,
  ADD COLUMN `suspendedAt` timestamp NULL AFTER `activatedDevice`,
  ADD COLUMN `suspendReason` text AFTER `suspendedAt`,
  ADD COLUMN `revokedAt` timestamp NULL AFTER `suspendReason`,
  ADD COLUMN `revokeReason` text AFTER `revokedAt`,
  ADD COLUMN `renewedAt` timestamp NULL AFTER `revokeReason`,
  ADD COLUMN `previousExpireTimestamp` bigint NULL AFTER `renewedAt`;

-- 2. 迁移现有数据状态
UPDATE `licenseKeys` SET `status` = 'ACTIVATED' WHERE `isActivated` = 1;
UPDATE `licenseKeys` SET `status` = 'EXPIRED'
  WHERE `expireTimestamp` < (UNIX_TIMESTAMP() * 1000) AND `isActivated` = 0;

-- 3. offlineKeys 表增加状态字段
ALTER TABLE `offlineKeys`
  ADD COLUMN `status` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED') NOT NULL DEFAULT 'ISSUED' AFTER `remark`;

-- 4. 密钥状态变更历史表
CREATE TABLE IF NOT EXISTS `keyStatusHistory` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `keyType` enum('online','offline') NOT NULL,
  `keyId` int NOT NULL,
  `fromStatus` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED'),
  `toStatus` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED') NOT NULL,
  `reason` text,
  `actorId` int NOT NULL,
  `actorName` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_ksh_keyId` (`keyType`, `keyId`),
  INDEX `idx_ksh_createdAt` (`createdAt`)
);

-- 5. 审计日志表
CREATE TABLE IF NOT EXISTS `auditLogs` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `userName` varchar(128),
  `action` enum('CREATE','UPDATE','DELETE','ACTIVATE','SUSPEND','REVOKE','RENEW','RESTORE','EXPORT','LOGIN','LOGOUT','UNBIND') NOT NULL,
  `resourceType` varchar(64),
  `resourceId` int,
  `before` text,
  `after` text,
  `description` text,
  `ip` varchar(64),
  `userAgent` varchar(512),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_al_userId` (`userId`),
  INDEX `idx_al_action` (`action`),
  INDEX `idx_al_resource` (`resourceType`, `resourceId`),
  INDEX `idx_al_createdAt` (`createdAt`)
);
