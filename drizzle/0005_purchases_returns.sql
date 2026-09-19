-- Migration number: 0005 	 2026-09-19T10:40:00.000Z

CREATE TABLE `purchases` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `vendor_name` text NOT NULL,
  `status` text NOT NULL,
  `location_id` text,
  `notes` text,
  `created_at` integer NOT NULL,
  `ordered_at` integer,
  `received_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`)
);

CREATE TABLE `purchase_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `purchase_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty_ordered` integer NOT NULL,
  `qty_received` integer NOT NULL DEFAULT 0,
  FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
CREATE UNIQUE INDEX `purchase_lines_purchase_item` ON `purchase_lines` (`purchase_id`, `item_id`);

CREATE TABLE `rmas` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `customer_name` text NOT NULL,
  `status` text NOT NULL,
  `order_id` text,
  `location_id` text,
  `notes` text,
  `created_at` integer NOT NULL,
  `received_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`),
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`)
);

CREATE TABLE `rma_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `rma_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty_expected` integer NOT NULL,
  `qty_received` integer NOT NULL DEFAULT 0,
  FOREIGN KEY (`rma_id`) REFERENCES `rmas`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
CREATE UNIQUE INDEX `rma_lines_rma_item` ON `rma_lines` (`rma_id`, `item_id`);
