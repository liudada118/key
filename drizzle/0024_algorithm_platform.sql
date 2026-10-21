CREATE TABLE `algorithm_manual_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`request_id` int NOT NULL,
	`customer_id` int NOT NULL,
	`version_id` int NOT NULL,
	`product_id` varchar(80) NOT NULL,
	`amount_minor` bigint NOT NULL,
	`currency` varchar(3) NOT NULL,
	`device_limit` int NOT NULL,
	`expires_at` timestamp,
	`terms` text NOT NULL,
	`status` enum('quoted','payment_confirmed','delivered','cancelled') NOT NULL DEFAULT 'quoted',
	`created_by_id` int NOT NULL,
	`paid_by_id` int,
	`delivered_by_id` int,
	`receipt_reference` text,
	`delivery_reference` text,
	`paid_at` timestamp,
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `algorithm_manual_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `algorithm_manual_orders_request_id_unique` UNIQUE(`request_id`)
);
--> statement-breakpoint
CREATE TABLE `algorithm_platform_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entity` varchar(24) NOT NULL,
	`entity_id` int NOT NULL,
	`actor_id` int,
	`customer_id` int,
	`action` varchar(40) NOT NULL,
	`details_json` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `algorithm_platform_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `algorithm_product_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` varchar(80) NOT NULL,
	`version` varchar(48) NOT NULL,
	`product_json` longtext NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`submitted_by_id` int NOT NULL,
	`reviewed_by_id` int,
	`status` enum('pending','published','rejected') NOT NULL DEFAULT 'pending',
	`review_note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`reviewed_at` timestamp,
	CONSTRAINT `algorithm_product_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `algorithm_product_version_unique` UNIQUE(`product_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `algorithm_products` (
	`id` varchar(80) NOT NULL,
	`owner_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `algorithm_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `algorithm_purchase_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`version_id` int NOT NULL,
	`product_id` varchar(80) NOT NULL,
	`kind` enum('quote','trial','custom') NOT NULL,
	`goal` text NOT NULL,
	`idempotency_key` varchar(80) NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`status` enum('requested','reviewing','quoted','cancelled') NOT NULL DEFAULT 'requested',
	`note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `algorithm_purchase_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `algorithm_request_retry` UNIQUE(`customer_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE INDEX `algorithm_order_customer` ON `algorithm_manual_orders` (`customer_id`,`id`);--> statement-breakpoint
CREATE INDEX `algorithm_platform_event_entity` ON `algorithm_platform_events` (`entity`,`entity_id`,`id`);--> statement-breakpoint
CREATE INDEX `algorithm_product_status` ON `algorithm_product_versions` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `algorithm_request_customer` ON `algorithm_purchase_requests` (`customer_id`,`id`);