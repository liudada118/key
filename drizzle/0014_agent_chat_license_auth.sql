CREATE TABLE `agent_chat_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int,
	`license_key_id` int,
	CONSTRAINT `agent_chat_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_source_customer` UNIQUE(`customer_id`),
	CONSTRAINT `agent_source_license` UNIQUE(`license_key_id`)
) ENGINE=InnoDB;
--> statement-breakpoint
INSERT INTO `agent_chat_sources` (`id`, `customer_id`)
SELECT id, id FROM (
  SELECT id FROM customers
  UNION SELECT tenant_id FROM agent_upload_credentials
  UNION SELECT tenant_id FROM agent_conversations
  UNION SELECT tenant_id FROM agent_sync_events
) AS existing_sources;
