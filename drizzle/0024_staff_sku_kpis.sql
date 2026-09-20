-- Migration number: 0024 	 2026-09-20T20:00:00.000Z
-- Staff × SKU labor KPIs: extra movement lookup indexes and pack actor events.

CREATE INDEX `movements_org_user_created` ON `inventory_movements` (`organization_id`, `created_by`, `created_at`);
--> statement-breakpoint
CREATE INDEX `movements_org_item_created` ON `inventory_movements` (`organization_id`, `item_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `pack_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pack_events_org_created` ON `pack_events` (`organization_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `pack_events_org_user` ON `pack_events` (`organization_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `pack_events_org_item` ON `pack_events` (`organization_id`, `item_id`, `created_at`);
