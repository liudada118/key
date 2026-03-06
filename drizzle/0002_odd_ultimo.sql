CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`contactPerson` varchar(128),
	`phone` varchar(32),
	`email` varchar(320),
	`address` text,
	`remark` text,
	`createdById` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `licenseKeys` MODIFY COLUMN `sensorType` varchar(512) NOT NULL;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `customerId` int;--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `customerName` varchar(256);