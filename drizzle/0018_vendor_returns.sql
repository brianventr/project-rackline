-- Migration number: 0018 	 2026-09-20T16:00:00.000Z

CREATE TABLE `vendor_returns` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `vendor_name` text NOT NULL,
  `status` text NOT NULL,
  `purchase_id` text,
  `location_id` text,
  `notes` text,
  `created_at` integer NOT NULL,
  `returned_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`),
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`)
);

CREATE TABLE `vendor_return_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `vendor_return_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty_expected` integer NOT NULL,
  `qty_returned` integer NOT NULL DEFAULT 0,
  FOREIGN KEY (`vendor_return_id`) REFERENCES `vendor_returns`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
CREATE UNIQUE INDEX `vendor_return_lines_rtv_item` ON `vendor_return_lines` (`vendor_return_id`, `item_id`);
