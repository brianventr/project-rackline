-- Migration number: 0021 	 2026-09-20T18:30:00.000Z

ALTER TABLE `warehouses` ADD `ship_from_address` text;
ALTER TABLE `orders` ADD `carrier_connection_id` text;
ALTER TABLE `orders` ADD `label_status` text NOT NULL DEFAULT 'none';

CREATE TABLE `carrier_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `provider` text NOT NULL,
  `nickname` text NOT NULL,
  `account_number` text,
  `mode` text NOT NULL DEFAULT 'demo',
  `status` text NOT NULL DEFAULT 'connected',
  `api_key` text,
  `api_secret` text,
  `meter_number` text,
  `enabled_services_json` text NOT NULL DEFAULT '[]',
  `is_default` integer NOT NULL DEFAULT 0,
  `last_tested_at` integer,
  `last_test_status` text,
  `last_test_error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `carrier_connections_org_provider` ON `carrier_connections` (`organization_id`, `provider`);

CREATE TABLE `carrier_outbound_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `connection_id` text,
  `order_id` text,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `request_json` text NOT NULL,
  `response_json` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`connection_id`) REFERENCES `carrier_connections`(`id`) ON DELETE set null,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade
);
