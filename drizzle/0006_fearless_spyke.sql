CREATE TABLE `keyDevices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyId` int NOT NULL,
	`deviceCode` varchar(256) NOT NULL,
	`deviceName` varchar(256),
	`boundAt` timestamp NOT NULL DEFAULT (now()),
	`boundIp` varchar(64),
	CONSTRAINT `keyDevices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `maxDevices` int DEFAULT 1 NOT NULL;