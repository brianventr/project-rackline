-- Migration number: 0032 	 2026-09-21T16:00:00.000Z
-- Uncarton / unreceive, ship one labeled carton, Shopify fulfillment per carton.

ALTER TABLE `order_packages` ADD `shipped_at` integer;
--> statement-breakpoint
ALTER TABLE `order_packages` ADD `shopify_fulfillment_id` text;
