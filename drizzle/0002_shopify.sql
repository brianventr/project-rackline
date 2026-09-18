-- Migration number: 0002 	 2026-09-18T20:45:00.000Z

ALTER TABLE `orders` ADD `source` text NOT NULL DEFAULT 'manual';
ALTER TABLE `orders` ADD `shopify_order_id` text;
ALTER TABLE `orders` ADD `shopify_order_gid` text;
ALTER TABLE `orders` ADD `shopify_order_name` text;
ALTER TABLE `orders` ADD `shopify_fulfillment_order_id` text;
ALTER TABLE `orders` ADD `shopify_fulfillment_id` text;
ALTER TABLE `orders` ADD `shopify_sync_status` text NOT NULL DEFAULT 'none';
ALTER TABLE `orders` ADD `shopify_sync_error` text;
ALTER TABLE `orders` ADD `shopify_fulfilled_at` integer;
ALTER TABLE `orders` ADD `shopify_shop_domain` text;
ALTER TABLE `orders` ADD `tracking_number` text;
ALTER TABLE `orders` ADD `tracking_company` text;
ALTER TABLE `orders` ADD `tracking_url` text;
CREATE UNIQUE INDEX `shopify_orders_org_order` ON `orders` (`organization_id`, `shopify_order_id`);

ALTER TABLE `order_lines` ADD `shopify_line_item_id` text;
ALTER TABLE `order_lines` ADD `shopify_fulfillment_line_item_id` text;

CREATE TABLE `shopify_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `shop_domain` text NOT NULL,
  `access_token` text,
  `webhook_secret` text NOT NULL,
  `api_version` text NOT NULL DEFAULT '2026-07',
  `shopify_location_gid` text,
  `mode` text NOT NULL DEFAULT 'demo',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `shopify_connections_org` ON `shopify_connections` (`organization_id`);
CREATE UNIQUE INDEX `shopify_connections_shop` ON `shopify_connections` (`shop_domain`);

CREATE TABLE `shopify_webhook_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `topic` text NOT NULL,
  `shop_domain` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE TABLE `shopify_outbound_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `order_id` text,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `request_json` text NOT NULL,
  `response_json` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade
);
