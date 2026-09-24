CREATE TABLE `usage_events` (
	`source_id` int NOT NULL,
	`installation_id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`occurred_ms` bigint NOT NULL,
	`app_version` varchar(80) NOT NULL,
	`environment` varchar(16) NOT NULL,
	`event_name` varchar(40) NOT NULL,
	`feature_id` varchar(80),
	`module` varchar(80),
	`result` varchar(16),
	`duration_ms` bigint,
	`occurrence_count` bigint NOT NULL,
	`error_fingerprint` varchar(64),
	`payload_hash` varchar(64) NOT NULL,
	`payload_json` text NOT NULL,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `usage_events_source_id_installation_id_event_id_pk` PRIMARY KEY(`source_id`,`installation_id`,`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `usage_sources` (
	`source_id` int NOT NULL,
	`customer_id` int,
	`customer_name` varchar(256) NOT NULL,
	`first_received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `usage_sources_source_id` PRIMARY KEY(`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE INDEX `usage_period` ON `usage_events` (`environment`,`occurred_ms`);--> statement-breakpoint
CREATE INDEX `usage_source_period` ON `usage_events` (`source_id`,`occurred_ms`);--> statement-breakpoint
CREATE INDEX `usage_session` ON `usage_events` (`source_id`,`installation_id`,`session_id`,`occurred_ms`);--> statement-breakpoint
CREATE INDEX `usage_errors` ON `usage_events` (`event_name`,`occurred_ms`);--> statement-breakpoint
CREATE INDEX `usage_source_customer` ON `usage_sources` (`customer_id`);