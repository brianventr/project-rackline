-- Migration number: 0006 	 2026-09-19T11:30:00.000Z

ALTER TABLE `receipt_lines` ADD `qty_received` integer NOT NULL DEFAULT 0;

UPDATE `receipt_lines`
SET `qty_received` = `qty`
WHERE `receipt_id` IN (SELECT `id` FROM `receipts` WHERE `status` = 'received');

CREATE UNIQUE INDEX `receipt_lines_receipt_item` ON `receipt_lines` (`receipt_id`, `item_id`);
