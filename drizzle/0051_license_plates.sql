-- Migration number: 0051 	 2026-10-01T01:30:00.000Z
-- License plates: a tote, pallet, or carton with its own LP- code that groups stock in a bay. The
-- bay's balances stay the ledger; plate lines are a share of them, never more than the bay holds.

CREATE TABLE `license_plates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `code` text NOT NULL,
  `type` text DEFAULT 'tote' NOT NULL,
  `location_id` text,
  `status` text DEFAULT 'open' NOT NULL,
  `created_by` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE cascade,
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE set null
);

CREATE UNIQUE INDEX `license_plates_org_code` ON `license_plates` (`organization_id`, `code`);
CREATE INDEX `license_plates_location` ON `license_plates` (`organization_id`, `location_id`);

CREATE TABLE `license_plate_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `plate_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `lot_code` text,
  `serial` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`plate_id`) REFERENCES `license_plates`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade
);

CREATE INDEX `license_plate_lines_plate` ON `license_plate_lines` (`plate_id`);
CREATE INDEX `license_plate_lines_item` ON `license_plate_lines` (`organization_id`, `item_id`);
