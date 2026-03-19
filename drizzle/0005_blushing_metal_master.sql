CREATE TABLE `offlineKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` varchar(32) NOT NULL,
	`sensorTypes` varchar(512) NOT NULL,
	`expireDate` bigint NOT NULL,
	`days` int NOT NULL,
	`activationCode` text NOT NULL,
	`rsaKeyPairId` int NOT NULL,
	`createdById` int NOT NULL,
	`createdByName` varchar(128),
	`customerId` int,
	`customerName` varchar(256),
	`remark` text,
	`licenseVersion` int NOT NULL DEFAULT 2,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `offlineKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rsaKeyPairs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL DEFAULT 'default',
	`privateKey` text NOT NULL,
	`publicKey` text NOT NULL,
	`keySize` int NOT NULL DEFAULT 2048,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rsaKeyPairs_id` PRIMARY KEY(`id`)
);
