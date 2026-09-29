-- Migration number: 0041 	 2026-09-29T16:00:00.000Z
-- Maker conversion: unit cost for accounting export, billing rate cards, channel connections.

ALTER TABLE `items` ADD `unit_cost_cents` integer NOT NULL DEFAULT 0;

ALTER TABLE `billing_accounts` ADD `rates_json` text;
ALTER TABLE `billing_accounts` ADD `portal_token` text;

CREATE TABLE `channel_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `channel` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `external_shop` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `channel_connections_org_channel` ON `channel_connections` (`organization_id`, `channel`);
