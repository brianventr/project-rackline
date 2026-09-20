-- Migration number: 0021 	 2026-09-20T17:10:00.000Z
-- Waves, ASN, 3PL clients, zones, labor, yard, batch pick lines, multi-WH transfer target.

CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `clients_org_code` ON `clients` (`organization_id`, `code`);

CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `zones_org_wh_code` ON `zones` (`organization_id`, `warehouse_id`, `code`);

ALTER TABLE `locations` ADD `zone_id` text REFERENCES `zones`(`id`) ON DELETE set null;

ALTER TABLE `orders` ADD `wave_id` text;
ALTER TABLE `orders` ADD `client_id` text REFERENCES `clients`(`id`) ON DELETE set null;

ALTER TABLE `receipts` ADD `client_id` text REFERENCES `clients`(`id`) ON DELETE set null;
ALTER TABLE `purchases` ADD `client_id` text REFERENCES `clients`(`id`) ON DELETE set null;

ALTER TABLE `transfers` ADD `to_warehouse_id` text REFERENCES `warehouses`(`id`);

CREATE TABLE `waves` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`number` text NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL DEFAULT 'wave',
	`zone_id` text,
	`client_id` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`released_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `waves_org_number` ON `waves` (`organization_id`, `number`);

CREATE TABLE `wave_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`wave_id` text NOT NULL,
	`order_id` text NOT NULL,
	FOREIGN KEY (`wave_id`) REFERENCES `waves`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `wave_orders_wave_order` ON `wave_orders` (`wave_id`, `order_id`);

CREATE TABLE `wave_batch_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`wave_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`qty_picked` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`wave_id`) REFERENCES `waves`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `wave_batch_lines_wave_item` ON `wave_batch_lines` (`wave_id`, `item_id`);

CREATE TABLE `asns` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`number` text NOT NULL,
	`vendor_name` text NOT NULL,
	`status` text NOT NULL,
	`purchase_id` text,
	`client_id` text,
	`location_id` text,
	`eta` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`expected_at` integer,
	`received_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `asns_org_number` ON `asns` (`organization_id`, `number`);

CREATE TABLE `asn_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`asn_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty_expected` integer NOT NULL,
	`qty_received` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`asn_id`) REFERENCES `asns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `asn_lines_asn_item` ON `asn_lines` (`asn_id`, `item_id`);

CREATE TABLE `yard_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`number` text NOT NULL,
	`status` text NOT NULL,
	`carrier_name` text NOT NULL,
	`trailer_number` text,
	`dock_location_id` text,
	`asn_id` text,
	`purchase_id` text,
	`eta` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`checked_in_at` integer,
	`checked_out_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dock_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asn_id`) REFERENCES `asns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `yard_visits_org_number` ON `yard_visits` (`organization_id`, `number`);

CREATE TABLE `labor_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`user_id` text NOT NULL,
	`verb` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`qty` integer,
	`duration_sec` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `labor_events_org_created` ON `labor_events` (`organization_id`, `created_at`);
CREATE INDEX `labor_events_org_user` ON `labor_events` (`organization_id`, `user_id`);
