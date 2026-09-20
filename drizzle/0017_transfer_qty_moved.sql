-- Migration number: 0017 	 2026-09-20T15:00:00.000Z

ALTER TABLE `transfer_lines` ADD `qty_moved` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `transfer_lines`
SET `qty_moved` = `qty`
WHERE `transfer_id` IN (
  SELECT `id` FROM `transfers` WHERE `status` = 'posted'
);
