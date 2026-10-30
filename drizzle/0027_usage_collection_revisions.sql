CREATE TABLE `usage_collection_revisions` (
  `source_id` int NOT NULL,
  `installation_id` varchar(36) NOT NULL,
  `collection_id` varchar(80) NOT NULL,
  `revision` int NOT NULL,
  `event_id` varchar(36) NOT NULL,
  `supersedes_event_id` varchar(36),
  `payload_hash` varchar(64) NOT NULL,
  PRIMARY KEY (`source_id`, `installation_id`, `collection_id`, `revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
