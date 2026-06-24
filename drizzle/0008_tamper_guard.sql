ALTER TABLE `keyStatusHistory` MODIFY COLUMN `fromStatus` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED','TAMPERED');--> statement-breakpoint
ALTER TABLE `keyStatusHistory` MODIFY COLUMN `toStatus` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED','TAMPERED') NOT NULL;--> statement-breakpoint
ALTER TABLE `licenseKeys` MODIFY COLUMN `status` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED','TAMPERED') NOT NULL DEFAULT 'ISSUED';--> statement-breakpoint
ALTER TABLE `offlineKeys` MODIFY COLUMN `status` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED','TAMPERED') NOT NULL DEFAULT 'ISSUED';--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `lastSeenClientTime` bigint;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `lastCheckAt` timestamp;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `tamperedAt` timestamp;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `tamperReason` text;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `reportedClientTime` bigint;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `tamperServerTime` bigint;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `statusBeforeTamper` enum('ISSUED','ACTIVATED','SUSPENDED','EXPIRED','RENEWED','REVOKED','TAMPERED');