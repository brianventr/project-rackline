-- Migration number: 0011 	 2026-09-19T22:40:00.000Z

CREATE TABLE `inventory_allocations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `order_id` text NOT NULL,
  `order_line_id` text NOT NULL,
  `location_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `released_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade,
  FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON DELETE cascade,
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`),
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
