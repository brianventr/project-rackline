-- Migration number: 0004 	 2026-09-19T04:00:00.000Z

ALTER TABLE `items` ADD `barcode` text;
UPDATE `items` SET `barcode` = `sku` WHERE `barcode` IS NULL OR `barcode` = '';
CREATE UNIQUE INDEX `items_org_barcode` ON `items` (`organization_id`,`barcode`);

ALTER TABLE `orders` ADD `packed_at` integer;
UPDATE `orders` SET `status` = 'open' WHERE `status` = 'draft';
