CREATE TABLE `system_package_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`submission_id` int NOT NULL,
	`actor_id` int NOT NULL,
	`action` varchar(32) NOT NULL,
	`details_json` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `system_package_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_package_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`system_id` varchar(80) NOT NULL,
	`name` varchar(160) NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`package_json` longtext NOT NULL,
	`status` enum('pending','rejected','published','revoked') NOT NULL DEFAULT 'pending',
	`submitted_by_id` int NOT NULL,
	`reviewed_by_id` int,
	`review_note` text,
	`audience_json` text,
	`signature` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`published_at` timestamp,
	CONSTRAINT `system_package_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `system_package_event_lookup` ON `system_package_events` (`submission_id`,`id`);--> statement-breakpoint
CREATE INDEX `system_package_lookup` ON `system_package_submissions` (`system_id`,`status`,`id`);
