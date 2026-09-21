-- Migration number: 0035 	 2026-09-21T22:10:00.000Z
-- Per-client rate cards, invoice issue timestamps, and client portal membership.

CREATE TABLE `client_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`unit_cents` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_rates_client_kind` ON `client_rates` (`client_id`,`kind`);
--> statement-breakpoint
CREATE INDEX `client_rates_org` ON `client_rates` (`organization_id`);
--> statement-breakpoint
ALTER TABLE `clients` ADD `billing_email` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `issued_at` integer;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `emailed_at` integer;
--> statement-breakpoint
ALTER TABLE `memberships` ADD `client_id` text;
--> statement-breakpoint
ALTER TABLE `kit_builds` ADD `client_id` text;
--> statement-breakpoint
ALTER TABLE `work_orders` ADD `client_id` text;
--> statement-breakpoint
ALTER TABLE `rmas` ADD `client_id` text;
