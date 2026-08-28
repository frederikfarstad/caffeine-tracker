ALTER TABLE `members` ADD `elimination_half_life_minutes` integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `sleep_threshold_mg` integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `bedtime_local` text DEFAULT '23:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `last_seen_patch_note` text;