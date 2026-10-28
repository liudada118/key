ALTER TABLE `agent_chat_sources`
  ADD `license_key_hash` varchar(64) NULL,
  ADD CONSTRAINT `agent_source_license_hash` UNIQUE (`license_key_hash`);
