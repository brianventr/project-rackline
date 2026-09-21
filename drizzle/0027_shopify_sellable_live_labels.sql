-- Migration number: 0027 	 2026-09-21T00:53:00.000Z
-- Shopify sellable qty, live aggregator postage ids, and parcel dims on the order.

ALTER TABLE `items` ADD `shopify_inventory_item_gid` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `package_weight_oz` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `package_length_in` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `package_width_in` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `package_height_in` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `carrier_shipment_id` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `carrier_label_id` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `postage_cents` integer;
