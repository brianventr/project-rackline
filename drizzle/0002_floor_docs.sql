-- Migration number: 0002 	 2026-09-18T21:00:00.000Z

ALTER TABLE `items` ADD `reorder_point` integer NOT NULL DEFAULT 0;

CREATE TABLE `transfers` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `status` text NOT NULL,
  `from_location_id` text NOT NULL,
  `to_location_id` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `posted_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`),
  FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`)
);

CREATE TABLE `transfer_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `transfer_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);

CREATE TABLE `cycle_counts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `status` text NOT NULL,
  `location_id` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `posted_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`)
);

CREATE TABLE `cycle_count_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `cycle_count_id` text NOT NULL,
  `item_id` text NOT NULL,
  `system_qty` integer NOT NULL,
  `counted_qty` integer NOT NULL,
  FOREIGN KEY (`cycle_count_id`) REFERENCES `cycle_counts`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
