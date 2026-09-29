CREATE TABLE `guild_secrets` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`typesafe_ciphertext` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `message_revision`;--> statement-breakpoint
ALTER TABLE `moderation_cases` ADD `message_revision` text DEFAULT 'created' NOT NULL;--> statement-breakpoint
UPDATE `moderation_cases` SET `message_revision` = 'legacy:' || `id`;--> statement-breakpoint
CREATE UNIQUE INDEX `message_revision` ON `moderation_cases` (`guild_id`,`message_id`,`message_revision`,`policy_version`);
