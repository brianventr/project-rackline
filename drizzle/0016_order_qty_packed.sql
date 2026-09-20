-- Migration number: 0016 	 2026-09-20T14:10:00.000Z

ALTER TABLE `order_lines` ADD `qty_packed` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `order_lines`
SET `qty_packed` = `qty_picked`
WHERE `order_id` IN (
  SELECT `id` FROM `orders` WHERE `status` IN ('packed', 'shipped')
);
