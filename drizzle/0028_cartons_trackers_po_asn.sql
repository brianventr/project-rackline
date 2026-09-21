-- Migration number: 0028 	 2026-09-21T02:10:00.000Z
-- Cartons on pack, tracker webhooks, and PO send → expected ASN.

ALTER TABLE `orders` ADD `tracker_status` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `tracker_updated_at` integer;
--> statement-breakpoint
ALTER TABLE `carrier_connections` ADD `webhook_secret` text;

CREATE TABLE `order_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_id` text NOT NULL,
	`number` text NOT NULL,
	`seq` integer NOT NULL,
	`weight_oz` integer,
	`length_in` integer,
	`width_in` integer,
	`height_in` integer,
	`tracking_number` text,
	`tracking_company` text,
	`tracking_url` text,
	`carrier_service` text,
	`carrier_connection_id` text,
	`carrier_shipment_id` text,
	`carrier_label_id` text,
	`postage_cents` integer,
	`label_status` text NOT NULL DEFAULT 'none',
	`tracker_status` text,
	`tracker_updated_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `order_packages_order_number` ON `order_packages` (`order_id`, `number`);
CREATE INDEX `order_packages_org_tracking` ON `order_packages` (`organization_id`, `tracking_number`);

CREATE TABLE `order_package_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `order_packages`(`id`) ON DELETE cascade,
	FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
CREATE UNIQUE INDEX `order_package_lines_pkg_line` ON `order_package_lines` (`package_id`, `order_line_id`);

CREATE TABLE `tracker_webhook_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`tracking_number` text,
	`event_id` text,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `tracker_webhook_receipts_event` ON `tracker_webhook_receipts` (`organization_id`, `event_id`);

CREATE TABLE `purchase_sends` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`to_address` text,
	`subject` text,
	`body` text NOT NULL,
	`mode` text NOT NULL DEFAULT 'demo',
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE cascade
);
