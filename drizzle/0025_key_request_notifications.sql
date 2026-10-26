ALTER TABLE `keyGenerationRequests`
  ADD `resultReadAt` timestamp NULL,
  ADD INDEX `key_requests_notice_idx` (`status`, `requestedById`, `resultReadAt`);
