-- Migration number: 0042 	 2026-09-30T14:00:00.000Z
-- Garage quick ship: per-SKU ship weight and dims, box presets, and a default carrier service per building.

ALTER TABLE `items` ADD `ship_weight_oz` integer;
ALTER TABLE `items` ADD `ship_length_in` integer;
ALTER TABLE `items` ADD `ship_width_in` integer;
ALTER TABLE `items` ADD `ship_height_in` integer;

ALTER TABLE `warehouses` ADD `default_carrier_connection_id` text;
ALTER TABLE `warehouses` ADD `default_carrier_service` text;

CREATE TABLE `package_presets` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `length_in` integer NOT NULL,
  `width_in` integer NOT NULL,
  `height_in` integer NOT NULL,
  `tare_oz` integer NOT NULL DEFAULT 0,
  `is_default` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `package_presets_org_name` ON `package_presets` (`organization_id`, `name`);
