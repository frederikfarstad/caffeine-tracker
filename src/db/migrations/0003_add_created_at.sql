/*
 A table rebuild rather than the ALTER that drizzle-kit generates for this
 change. SQLite refuses `ADD COLUMN ... NOT NULL` without a constant default,
 and the value existing rows need is `consumed_at` — a column, not a constant.
 Rebuilding is the standard SQLite workaround and lets the backfill happen in
 the copy.
*/
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_drink_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`drink_type_id` integer NOT NULL,
	`caffeine_mg` integer NOT NULL,
	`category` text NOT NULL,
	`consumed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`local_date` text NOT NULL,
	`local_hour` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drink_type_id`) REFERENCES `drink_types`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_drink_logs` (`id`, `user_id`, `drink_type_id`, `caffeine_mg`, `category`, `consumed_at`, `created_at`, `local_date`, `local_hour`)
SELECT `id`, `user_id`, `drink_type_id`, `caffeine_mg`, `category`, `consumed_at`, `consumed_at`, `local_date`, `local_hour` FROM `drink_logs`;--> statement-breakpoint
DROP TABLE `drink_logs`;--> statement-breakpoint
ALTER TABLE `__new_drink_logs` RENAME TO `drink_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `drink_logs_user_date_idx` ON `drink_logs` (`user_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `drink_logs_date_idx` ON `drink_logs` (`local_date`);--> statement-breakpoint
CREATE INDEX `drink_logs_user_recent_idx` ON `drink_logs` (`user_id`,`created_at`);
