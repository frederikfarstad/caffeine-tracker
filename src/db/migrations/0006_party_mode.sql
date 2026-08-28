CREATE TABLE `alcohol_drink_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`volume_ml` integer NOT NULL,
	`abv_percent` real NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alcohol_drink_types_slug_unique` ON `alcohol_drink_types` (`slug`);--> statement-breakpoint
CREATE TABLE `alcohol_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`drink_type_id` integer NOT NULL,
	`alcohol_grams` real NOT NULL,
	`category` text NOT NULL,
	`volume_ml` integer NOT NULL,
	`consumed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`local_date` text NOT NULL,
	`local_hour` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drink_type_id`) REFERENCES `alcohol_drink_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alcohol_logs_user_date_idx` ON `alcohol_logs` (`user_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `alcohol_logs_date_idx` ON `alcohol_logs` (`local_date`);--> statement-breakpoint
CREATE INDEX `alcohol_logs_user_recent_idx` ON `alcohol_logs` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `members` ADD `party_mode` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `body_weight_kg` integer;--> statement-breakpoint
ALTER TABLE `members` ADD `sex` text;