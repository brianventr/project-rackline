ALTER TABLE `orders` ADD `external_order_id` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `channel_sync_status` text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE `orders` ADD `channel_sync_error` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `channel_fulfilled_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_org_source_external` ON `orders` (`organization_id`,`source`,`external_order_id`);
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `mode` text DEFAULT 'csv' NOT NULL;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `api_base` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `api_key` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `api_secret` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `webhook_secret` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `access_token` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `refresh_token` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `token_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `external_shop_id` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `oauth_state` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `oauth_verifier` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `last_sync_at` integer;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `last_sync_error` text;
--> statement-breakpoint
ALTER TABLE `channel_connections` ADD `warehouse_id` text REFERENCES warehouses(id);
