CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `daily_totals` (
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`total_mg` integer DEFAULT 0 NOT NULL,
	`coffee_count` integer DEFAULT 0 NOT NULL,
	`energy_count` integer DEFAULT 0 NOT NULL,
	`other_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `local_date`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_totals_date_idx` ON `daily_totals` (`local_date`);--> statement-breakpoint
CREATE TABLE `drink_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`drink_type_id` integer NOT NULL,
	`caffeine_mg` integer NOT NULL,
	`category` text NOT NULL,
	`consumed_at` integer NOT NULL,
	`local_date` text NOT NULL,
	`local_hour` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drink_type_id`) REFERENCES `drink_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `drink_logs_user_date_idx` ON `drink_logs` (`user_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `drink_logs_date_idx` ON `drink_logs` (`local_date`);--> statement-breakpoint
CREATE INDEX `drink_logs_user_recent_idx` ON `drink_logs` (`user_id`,`consumed_at`);--> statement-breakpoint
CREATE TABLE `drink_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`volume_ml` integer,
	`caffeine_mg` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drink_types_slug_unique` ON `drink_types` (`slug`);--> statement-breakpoint
CREATE TABLE `members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
