-- Migration number: 0003 	 2026-09-18T22:00:00.000Z

ALTER TABLE `warehouses` ADD `map_width` integer NOT NULL DEFAULT 42;
ALTER TABLE `warehouses` ADD `map_depth` integer NOT NULL DEFAULT 28;
ALTER TABLE `warehouses` ADD `map_height` integer NOT NULL DEFAULT 8;

ALTER TABLE `locations` ADD `barcode` text NOT NULL DEFAULT '';
ALTER TABLE `locations` ADD `area` text NOT NULL DEFAULT 'floor';
ALTER TABLE `locations` ADD `aisle` text;
ALTER TABLE `locations` ADD `rack` text;
ALTER TABLE `locations` ADD `bay` text;
ALTER TABLE `locations` ADD `level` integer NOT NULL DEFAULT 1;
ALTER TABLE `locations` ADD `pos_x` integer NOT NULL DEFAULT 0;
ALTER TABLE `locations` ADD `pos_y` integer NOT NULL DEFAULT 0;
ALTER TABLE `locations` ADD `pos_z` integer NOT NULL DEFAULT 0;
ALTER TABLE `locations` ADD `size_x` integer NOT NULL DEFAULT 4;
ALTER TABLE `locations` ADD `size_y` integer NOT NULL DEFAULT 3;
ALTER TABLE `locations` ADD `size_z` integer NOT NULL DEFAULT 2;

UPDATE `locations` SET `barcode` = `code` WHERE `barcode` = '';

CREATE UNIQUE INDEX `locations_org_barcode` ON `locations` (`organization_id`, `barcode`);
