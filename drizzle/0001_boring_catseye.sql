CREATE TABLE `licenseKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyString` text NOT NULL,
	`sensorType` varchar(32) NOT NULL,
	`category` enum('production','rental') NOT NULL,
	`days` int NOT NULL,
	`expireTimestamp` bigint NOT NULL,
	`createdById` int NOT NULL,
	`createdByName` varchar(128),
	`isActivated` boolean NOT NULL DEFAULT false,
	`activatedAt` timestamp,
	`activatedDevice` text,
	`batchId` varchar(64),
	`remark` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `licenseKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','super_admin') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `createdById` int;--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `remark` text;