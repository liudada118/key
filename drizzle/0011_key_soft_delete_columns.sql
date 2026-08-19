SET @license_keys_is_deleted_exists = (
	SELECT COUNT(*)
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND LOWER(TABLE_NAME) = LOWER('licenseKeys')
		AND LOWER(COLUMN_NAME) = LOWER('isDeleted')
);
--> statement-breakpoint
SET @license_keys_is_deleted_sql = IF(
	@license_keys_is_deleted_exists = 0,
	'ALTER TABLE `licenseKeys` ADD `isDeleted` boolean NOT NULL DEFAULT false',
	'SELECT 1'
);
--> statement-breakpoint
PREPARE license_keys_is_deleted_stmt FROM @license_keys_is_deleted_sql;
--> statement-breakpoint
EXECUTE license_keys_is_deleted_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE license_keys_is_deleted_stmt;
--> statement-breakpoint
SET @offline_keys_is_deleted_exists = (
	SELECT COUNT(*)
	FROM information_schema.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND LOWER(TABLE_NAME) = LOWER('offlineKeys')
		AND LOWER(COLUMN_NAME) = LOWER('isDeleted')
);
--> statement-breakpoint
SET @offline_keys_is_deleted_sql = IF(
	@offline_keys_is_deleted_exists = 0,
	'ALTER TABLE `offlineKeys` ADD `isDeleted` boolean NOT NULL DEFAULT false',
	'SELECT 1'
);
--> statement-breakpoint
PREPARE offline_keys_is_deleted_stmt FROM @offline_keys_is_deleted_sql;
--> statement-breakpoint
EXECUTE offline_keys_is_deleted_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE offline_keys_is_deleted_stmt;
