CREATE TABLE `sensorTypes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(128) NOT NULL,
	`value` varchar(128) NOT NULL,
	`groupName` varchar(128) NOT NULL,
	`groupIcon` varchar(16) NOT NULL DEFAULT '📦',
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sensorTypes_id` PRIMARY KEY(`id`),
	CONSTRAINT `sensorTypes_value_unique` UNIQUE(`value`)
);
