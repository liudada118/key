CREATE TABLE `keyGenerationRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestNo` varchar(64) NOT NULL,
	`mode` enum('single','batch') NOT NULL,
	`sensorTypes` text NOT NULL,
	`days` int NOT NULL,
	`category` enum('production','rental') NOT NULL DEFAULT 'production',
	`count` int NOT NULL DEFAULT 1,
	`reason` text NOT NULL,
	`generationRemark` text,
	`requestedById` int NOT NULL,
	`requestedByName` varchar(128) NOT NULL,
	`status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`reviewedById` int,
	`reviewedByName` varchar(128),
	`reviewRemark` text,
	`reviewedAt` timestamp,
	`generatedAt` timestamp,
	`generatedBatchId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyGenerationRequests_id` PRIMARY KEY(`id`),
	CONSTRAINT `keyGenerationRequests_requestNo_unique` UNIQUE(`requestNo`)
);
--> statement-breakpoint
ALTER TABLE `licenseKeys` ADD `generationRequestId` int;
