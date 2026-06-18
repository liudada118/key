CREATE TABLE `alertRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`type` enum('EXPIRY_WARNING','HEARTBEAT_LOST','QUOTA_EXCEEDED','CONTRACT_EXPIRY') NOT NULL,
	`config` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdById` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alertRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ruleId` int,
	`type` enum('EXPIRY_WARNING','HEARTBEAT_LOST','QUOTA_EXCEEDED','CONTRACT_EXPIRY') NOT NULL,
	`level` enum('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'WARNING',
	`title` varchar(256) NOT NULL,
	`content` text,
	`resourceType` varchar(64),
	`resourceId` int,
	`isRead` boolean NOT NULL DEFAULT false,
	`isResolved` boolean NOT NULL DEFAULT false,
	`resolvedAt` timestamp,
	`resolvedById` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('REVOKE','BATCH_GENERATE','DELETE','SUSPEND') NOT NULL,
	`status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`requesterId` int NOT NULL,
	`requesterName` varchar(128),
	`approverId` int,
	`approverName` varchar(128),
	`resourceType` varchar(64) NOT NULL,
	`resourceId` int,
	`requestData` text,
	`reason` text,
	`rejectReason` text,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	CONSTRAINT `approvals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
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
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractNo` varchar(128) NOT NULL,
	`title` varchar(256) NOT NULL,
	`customerId` int,
	`customerName` varchar(256),
	`signDate` date,
	`startDate` date,
	`endDate` date,
	`totalKeys` int NOT NULL DEFAULT 0,
	`usedKeys` int NOT NULL DEFAULT 0,
	`status` enum('DRAFT','ACTIVE','EXPIRED','TERMINATED') NOT NULL DEFAULT 'DRAFT',
	`remark` text,
	`createdById` int NOT NULL,
	`createdByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contracts_contractNo_unique` UNIQUE(`contractNo`)
);
--> statement-breakpoint
CREATE TABLE `deviceHeartbeats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyId` int NOT NULL,
	`keyType` enum('online','offline') NOT NULL DEFAULT 'online',
	`deviceCode` varchar(256) NOT NULL,
	`lastHeartbeatAt` timestamp NOT NULL DEFAULT (now()),
	`heartbeatCount` int NOT NULL DEFAULT 1,
	`clientIp` varchar(64),
	`clientVersion` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deviceHeartbeats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyStatusHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyType` enum('online','offline') NOT NULL,
	`keyId` int NOT NULL,
	`fromStatus` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED'),
	`toStatus` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED') NOT NULL,
	`reason` text,
	`actorId` int NOT NULL,
	`actorName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyStatusHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `offlineBlacklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` varchar(32) NOT NULL,
	`offlineKeyId` int,
	`reason` text,
	`addedById` int NOT NULL,
	`addedByName` varchar(128),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `offlineBlacklist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`leaderId` int,
	`leaderName` varchar(128),
	`parentTeamId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `teams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `keyHash` varchar(64);--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `contractId` int;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `contractNo` varchar(128);--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `status` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED') DEFAULT 'ISSUED' NOT NULL;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `suspendedAt` timestamp;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `suspendReason` text;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `revokedAt` timestamp;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `revokeReason` text;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `renewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `previousExpireTimestamp` bigint;--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `contractId` int;--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `contractNo` varchar(128);--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `status` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED') DEFAULT 'ISSUED' NOT NULL;--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `suspendedAt` timestamp;--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `suspendReason` text;--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `revokedAt` timestamp;--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `revokeReason` text;--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `users` ADD `teamId` int;