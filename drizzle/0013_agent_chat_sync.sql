CREATE TABLE `agent_upload_credentials` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `token_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  `token_prefix` varchar(16) NOT NULL,
  `tenant_id` int NOT NULL,
  `name` varchar(128) NOT NULL,
  `scope` varchar(64) NOT NULL DEFAULT 'agent:upload',
  `created_by_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NOT NULL,
  `revoked_at` timestamp NULL,
  INDEX `agent_credentials_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `agent_conversations` (
  `tenant_id` int NOT NULL,
  `installation_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `conversation_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` bigint unsigned NOT NULL,
  `snapshot_json` longtext NOT NULL,
  `received_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`, `installation_id`, `conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE `agent_sync_events` (
  `tenant_id` int NOT NULL,
  `installation_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_id` varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `conversation_id` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` bigint unsigned NOT NULL,
  `payload_hash` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `accepted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`, `installation_id`, `event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
