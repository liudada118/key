CREATE TABLE `system_package_rollouts` (
	`system_id` varchar(80) NOT NULL,
	`customer_id` int NOT NULL,
	`version_id` int NOT NULL,
	`updated_by_id` int NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_package_rollouts_system_id_customer_id_pk` PRIMARY KEY(`system_id`,`customer_id`)
);
--> statement-breakpoint
CREATE INDEX `system_package_rollout_version` ON `system_package_rollouts` (`version_id`);