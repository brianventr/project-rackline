-- Migration number: 0022 	 2026-09-20T18:40:00.000Z
-- Warehouse origin + order destination geo for Analytics traffic.

ALTER TABLE `warehouses` ADD `city` text;
ALTER TABLE `warehouses` ADD `region` text;
ALTER TABLE `warehouses` ADD `country` text;
ALTER TABLE `warehouses` ADD `lat` real;
ALTER TABLE `warehouses` ADD `lng` real;

ALTER TABLE `orders` ADD `ship_to_city` text;
ALTER TABLE `orders` ADD `ship_to_region` text;
ALTER TABLE `orders` ADD `ship_to_country` text;
ALTER TABLE `orders` ADD `ship_to_lat` real;
ALTER TABLE `orders` ADD `ship_to_lng` real;

CREATE INDEX `orders_org_status_shipped` ON `orders` (`organization_id`, `status`, `shipped_at`);
