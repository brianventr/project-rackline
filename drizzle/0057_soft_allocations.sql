-- Migration number: 0057 	 2026-10-01T15:30:00.000Z
-- Soft ATP reserve at ingest. No bay is pinned; pick start converts the row into inventory_allocations.

ALTER TABLE `orders` ADD `stock_reserved_at` integer;

CREATE TABLE `soft_allocations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `order_id` text NOT NULL,
  `order_line_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `released_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade,
  FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);

CREATE INDEX `soft_allocations_org_status` ON `soft_allocations` (`organization_id`, `status`);
CREATE INDEX `soft_allocations_order` ON `soft_allocations` (`order_id`);
CREATE UNIQUE INDEX `soft_allocations_open_line` ON `soft_allocations` (`order_line_id`) WHERE `status` = 'open';
