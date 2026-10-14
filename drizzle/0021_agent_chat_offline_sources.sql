ALTER TABLE `agent_chat_sources` ADD `offline_key_id` int;--> statement-breakpoint
ALTER TABLE `agent_chat_sources` ADD CONSTRAINT `agent_source_offline_license` UNIQUE(`offline_key_id`);