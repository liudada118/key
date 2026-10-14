CREATE TABLE `license_device_policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key_type` varchar(16) NOT NULL,
	`key_id` int NOT NULL,
	`max_devices` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `license_device_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `license_device_policy_identity` UNIQUE(`key_type`,`key_id`)
);
--> statement-breakpoint
CREATE TABLE `license_devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key_type` varchar(16) NOT NULL,
	`key_id` int NOT NULL,
	`device_id` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`first_seen_at` bigint NOT NULL,
	`last_seen_at` bigint NOT NULL,
	CONSTRAINT `license_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `license_device_identity` UNIQUE(`key_type`,`key_id`,`device_id`)
);
