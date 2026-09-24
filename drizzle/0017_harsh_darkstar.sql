CREATE TABLE `system_package_submit_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	CONSTRAINT `system_package_submit_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_package_submit_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `system_package_submit_user` ON `system_package_submit_tokens` (`user_id`);