-- Migration number: 0033 	 2026-09-21T18:00:00.000Z
-- Short ship closes a partial carton shipment and links a backorder child.

ALTER TABLE `orders` ADD `parent_order_id` text;
--> statement-breakpoint
CREATE INDEX `orders_parent` ON `orders` (`parent_order_id`);
