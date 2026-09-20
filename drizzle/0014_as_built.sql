-- Migration number: 0014 	 2026-09-20T12:30:00.000Z

CREATE TABLE `as_built` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`parent_item_id` text NOT NULL,
	`parent_lot_code` text,
	`parent_serial` text,
	`component_item_id` text NOT NULL,
	`component_lot_code` text,
	`component_serial` text,
	`qty` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `as_built_org_ref` ON `as_built` (`organization_id`,`ref_id`);
--> statement-breakpoint
CREATE INDEX `as_built_org_parent_serial` ON `as_built` (`organization_id`,`parent_serial`);
--> statement-breakpoint
CREATE INDEX `as_built_org_component_lot` ON `as_built` (`organization_id`,`component_item_id`,`component_lot_code`);
