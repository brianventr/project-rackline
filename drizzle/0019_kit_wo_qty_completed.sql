-- Migration number: 0019 	 2026-09-20T16:10:00.000Z

ALTER TABLE `kit_builds` ADD `qty_completed` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `work_orders` ADD `qty_completed` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `kit_builds`
SET `qty_completed` = `qty`
WHERE `status` = 'completed';
--> statement-breakpoint
UPDATE `work_orders`
SET `qty_completed` = `qty`
WHERE `status` = 'completed';
