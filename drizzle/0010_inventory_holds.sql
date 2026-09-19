-- Migration number: 0010 	 2026-09-19T21:50:00.000Z

CREATE TABLE `inventory_holds` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `status` text NOT NULL,
  `location_id` text NOT NULL,
  `item_id` text,
  `lot_code` text,
  `reason` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `released_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`),
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
