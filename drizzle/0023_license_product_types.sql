ALTER TABLE `licenseKeys` ADD `productType` enum('shroom-desktop','shroom-sdk') DEFAULT 'shroom-desktop' NOT NULL;
--> statement-breakpoint
ALTER TABLE `offlineKeys` ADD `productType` enum('shroom-desktop','shroom-sdk') DEFAULT 'shroom-desktop' NOT NULL;
--> statement-breakpoint
ALTER TABLE `keyGenerationRequests` ADD `productType` enum('shroom-desktop','shroom-sdk') DEFAULT 'shroom-desktop' NOT NULL;
