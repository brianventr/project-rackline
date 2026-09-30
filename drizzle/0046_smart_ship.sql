-- Migration number: 0046 	 2026-09-30T23:00:00.000Z
-- Smart ship: ordered shipping rules per org (optionally one building) and why each order got its box and service.

CREATE TABLE `ship_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text,
  `name` text NOT NULL,
  `position` integer NOT NULL DEFAULT 0,
  `enabled` integer NOT NULL DEFAULT 1,
  `conditions_json` text NOT NULL DEFAULT '{}',
  `preset_id` text,
  `carrier_service` text,
  `carrier_connection_id` text,
  `rate_strategy` text,
  `hold` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE cascade,
  FOREIGN KEY (`preset_id`) REFERENCES `package_presets`(`id`) ON DELETE set null
);

CREATE INDEX `ship_rules_org_position` ON `ship_rules` (`organization_id`, `position`);

ALTER TABLE `orders` ADD `ship_reason` text;

-- Automatic rate choice per building, and the delivery promise the on-time choice aims for.
ALTER TABLE `warehouses` ADD `rate_strategy` text DEFAULT 'default' NOT NULL;
ALTER TABLE `warehouses` ADD `delivery_days` integer;

-- Inside size and weight limit per box, so quick-ship can pick the smallest box that fits.
ALTER TABLE `package_presets` ADD `inner_length_in` real;
ALTER TABLE `package_presets` ADD `inner_width_in` real;
ALTER TABLE `package_presets` ADD `inner_height_in` real;
ALTER TABLE `package_presets` ADD `max_weight_oz` integer;
