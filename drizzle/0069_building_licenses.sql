-- Migration number: 0069 	 2026-10-21T20:30:00.000Z
-- A building license is the monthly right to one building.

CREATE TABLE `building_licenses` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `plan` text NOT NULL,
  `price_dollars` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `building_licenses_warehouse` ON `building_licenses` (`warehouse_id`);
CREATE INDEX `building_licenses_org` ON `building_licenses` (`organization_id`);

INSERT INTO `building_licenses` (`id`, `organization_id`, `warehouse_id`, `plan`, `price_dollars`, `created_at`)
SELECT
  'lic-' || `warehouses`.`id`,
  `warehouses`.`organization_id`,
  `warehouses`.`id`,
  CASE WHEN `organizations`.`operating_mode` = 'garage' THEN 'garage' ELSE 'manufacturer' END,
  CASE WHEN `organizations`.`operating_mode` = 'garage' THEN 150 ELSE 799 END,
  `warehouses`.`created_at`
FROM `warehouses`
INNER JOIN `organizations` ON `organizations`.`id` = `warehouses`.`organization_id`;
