-- Migration number: 0020 	 2026-09-20T16:40:00.000Z

ALTER TABLE `replenishments` ADD `qty_moved` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `replenishments`
SET `qty_moved` = `qty`
WHERE `status` = 'posted';
