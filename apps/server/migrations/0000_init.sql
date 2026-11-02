CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`kdf` text NOT NULL,
	`kdf_salt` blob NOT NULL,
	`auth_key_hmac` blob NOT NULL,
	`recovery_auth_hmac` blob NOT NULL,
	`wrapped_vault_key` blob NOT NULL,
	`wrapped_vault_key_recovery` blob NOT NULL,
	`totp_secret_enc` blob,
	`totp_enabled` integer DEFAULT 0 NOT NULL,
	`totp_last_step` integer,
	`recovery_code_hmacs` text DEFAULT '[]' NOT NULL,
	`recovery_token_hash` blob,
	`recovery_token_expires_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_email_unique` ON `account` (`email`);--> statement-breakpoint
CREATE TABLE `device_session` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`device_name` text NOT NULL,
	`token_hash` blob NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_session_token_hash_unique` ON `device_session` (`token_hash`);--> statement-breakpoint
CREATE TABLE `item` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`revision` integer NOT NULL,
	`ciphertext` blob,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`purge_after` integer,
	`purged_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_size_max" CHECK("item"."size" <= 65536)
);
--> statement-breakpoint
CREATE INDEX `item_account_revision_idx` ON `item` (`account_id`,`revision`);--> statement-breakpoint
CREATE TABLE `login_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` blob NOT NULL,
	`account_id` text,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempt_ip_at_idx` ON `login_attempt` (`ip_hash`,`at`);--> statement-breakpoint
CREATE INDEX `login_attempt_account_at_idx` ON `login_attempt` (`account_id`,`at`);