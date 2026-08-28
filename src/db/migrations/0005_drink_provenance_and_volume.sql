ALTER TABLE `drink_logs` ADD `volume_ml` integer;--> statement-breakpoint
/*
 A table rebuild for `drink_types` rather than the plain ADD COLUMN drizzle-kit
 generates. Its output omits the `ON DELETE SET NULL` action, leaving the FK at
 NO ACTION — which would make deleting a member who had added a drink fail
 outright, and the privacy page promises account deletion works. A drink has to
 outlive whoever added it.
*/
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_drink_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`volume_ml` integer,
	`caffeine_mg` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_drink_types` (`id`, `slug`, `name`, `category`, `volume_ml`, `caffeine_mg`, `is_active`, `sort_order`, `created_by`)
SELECT `id`, `slug`, `name`, `category`, `volume_ml`, `caffeine_mg`, `is_active`, `sort_order`, NULL FROM `drink_types`;--> statement-breakpoint
DROP TABLE `drink_types`;--> statement-breakpoint
ALTER TABLE `__new_drink_types` RENAME TO `drink_types`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `drink_types_slug_unique` ON `drink_types` (`slug`);
