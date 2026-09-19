-- Migration number: 0008 	 2026-09-19T18:00:00.000Z

ALTER TABLE `order_lines` ADD `qty_picked` integer NOT NULL DEFAULT 0;

UPDATE `order_lines`
SET `qty_picked` = `qty`
WHERE `order_id` IN (
  SELECT `id` FROM `orders` WHERE `status` IN ('picked', 'packing', 'packed', 'shipped')
);
