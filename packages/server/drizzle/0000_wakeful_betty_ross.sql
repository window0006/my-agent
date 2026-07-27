CREATE TABLE `memories` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(64) NOT NULL DEFAULT 'default-user',
	`key_name` varchar(128) NOT NULL,
	`value` text NOT NULL,
	`importance` tinyint NOT NULL DEFAULT 5,
	`source` varchar(32) NOT NULL DEFAULT 'extracted',
	`expires_at` bigint,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `memories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_memories_user_key` UNIQUE(`user_id`,`key_name`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	`content` text NOT NULL,
	`tool_call_id` varchar(64),
	`tool_name` varchar(64),
	`tool_calls` json,
	`created_at` bigint NOT NULL,
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_summaries` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`summary` text NOT NULL,
	`key_points` json,
	`range_start` bigint NOT NULL,
	`range_end` bigint NOT NULL,
	`message_count` bigint NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `session_summaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(64) NOT NULL DEFAULT 'default-user',
	`title` varchar(255) NOT NULL DEFAULT 'New Session',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `fk_messages_session_id` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session_summaries` ADD CONSTRAINT `fk_summaries_session_id` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_memories_user_id` ON `memories` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_memories_importance` ON `memories` (`user_id`,`importance`);--> statement-breakpoint
CREATE INDEX `idx_messages_session_id` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_created_at` ON `messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_summaries_session_id` ON `session_summaries` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_summaries_created_at` ON `session_summaries` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_updated_at` ON `sessions` (`updated_at`);