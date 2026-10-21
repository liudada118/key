CREATE TABLE `upload_data_guards` (
	`kind` varchar(16) NOT NULL,
	`source_id` int NOT NULL,
	`installation_id` varchar(36) NOT NULL,
	`object_id` varchar(160) NOT NULL,
	`blocked` boolean NOT NULL DEFAULT false,
	`payload_hash` varchar(64),
	`deleted_at` timestamp,
	CONSTRAINT `upload_data_guards_kind_source_id_installation_id_object_id_pk` PRIMARY KEY(`kind`,`source_id`,`installation_id`,`object_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `upload_deletion_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int,
	`action` varchar(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`affected` int NOT NULL,
	`scope_json` text NOT NULL,
	`cutoff_ms` bigint,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `upload_deletion_audit_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE INDEX `upload_deletion_audit_created` ON `upload_deletion_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `agent_retention_received` ON `agent_conversations` (`received_at`);--> statement-breakpoint
CREATE INDEX `usage_retention_received` ON `usage_events` (`received_at`);