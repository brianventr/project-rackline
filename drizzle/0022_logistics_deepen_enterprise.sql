-- Migration number: 0022 	 2026-09-20T18:00:00.000Z
-- Iteration 25: client stock overlay, labor clocks, carriers, EDI, UoM, billing.

CREATE TABLE `client_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`location_id` text NOT NULL,
	`item_id` text NOT NULL,
	`client_id` text NOT NULL,
	`qty` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `client_balances_org_loc_item_client` ON `client_balances` (`organization_id`, `location_id`, `item_id`, `client_id`);

ALTER TABLE `inventory_movements` ADD `client_id` text REFERENCES `clients`(`id`) ON DELETE set null;

CREATE TABLE `labor_clocks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`user_id` text NOT NULL,
	`verb` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_sec` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `labor_clocks_org_user_open` ON `labor_clocks` (`organization_id`, `user_id`, `ended_at`);

CREATE TABLE `carrier_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`carrier` text NOT NULL,
	`account_number` text NOT NULL,
	`mode` text NOT NULL DEFAULT 'demo',
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `carrier_accounts_org_carrier` ON `carrier_accounts` (`organization_id`, `carrier`);

CREATE TABLE `edi_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`created_asn_id` text,
	`created_at` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_asn_id`) REFERENCES `asns`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `edi_inbox_org_created` ON `edi_inbox` (`organization_id`, `created_at`);

ALTER TABLE `items` ADD `stock_uom` text NOT NULL DEFAULT 'ea';
ALTER TABLE `items` ADD `alt_uom` text;
ALTER TABLE `items` ADD `alt_per_stock` integer;

CREATE TABLE `billing_accounts` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL DEFAULT 'free',
	`status` text NOT NULL DEFAULT 'active',
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `invoices_org_number` ON `invoices` (`organization_id`, `number`);
