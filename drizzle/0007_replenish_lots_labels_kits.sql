-- Migration number: 0007 	 2026-09-19T17:40:00.000Z

ALTER TABLE `locations` ADD `slot_role` text NOT NULL DEFAULT 'none';
ALTER TABLE `items` ADD `pick_min` integer NOT NULL DEFAULT 0;
ALTER TABLE `items` ADD `track_lot` integer NOT NULL DEFAULT 0;
ALTER TABLE `items` ADD `track_serial` integer NOT NULL DEFAULT 0;
ALTER TABLE `inventory_movements` ADD `lot_code` text;
ALTER TABLE `inventory_movements` ADD `serials_json` text;
ALTER TABLE `orders` ADD `ship_to_address` text;
ALTER TABLE `orders` ADD `carrier_service` text;

CREATE TABLE `lot_balances` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `item_id` text NOT NULL,
  `lot_code` text NOT NULL,
  `qty` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `lot_balances_org_loc_item_lot` ON `lot_balances` (`organization_id`, `location_id`, `item_id`, `lot_code`);

CREATE TABLE `serials` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `item_id` text NOT NULL,
  `serial_code` text NOT NULL,
  `location_id` text,
  `status` text NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade,
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE set null
);
CREATE UNIQUE INDEX `serials_org_item_code` ON `serials` (`organization_id`, `item_id`, `serial_code`);

CREATE TABLE `replenishments` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `status` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `from_location_id` text NOT NULL,
  `to_location_id` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `posted_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`),
  FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`),
  FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`)
);

CREATE TABLE `kit_builds` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `status` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `source_location_id` text NOT NULL,
  `output_location_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`),
  FOREIGN KEY (`source_location_id`) REFERENCES `locations`(`id`),
  FOREIGN KEY (`output_location_id`) REFERENCES `locations`(`id`)
);
