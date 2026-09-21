-- Migration number: 0036 	 2026-09-21T23:10:00.000Z
-- Brand build requests, and a serial on an inventory hold.

CREATE TABLE `build_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`client_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`status` text NOT NULL,
	`warehouse_id` text,
	`ref_type` text,
	`ref_id` text,
	`created_at` integer NOT NULL,
	`released_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `build_requests_org_status` ON `build_requests` (`organization_id`,`status`);
--> statement-breakpoint
CREATE INDEX `build_requests_client` ON `build_requests` (`client_id`);
--> statement-breakpoint
ALTER TABLE `inventory_holds` ADD `serial_code` text;
