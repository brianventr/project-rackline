-- Migration number: 0063 	 2026-10-01T20:30:00.000Z
-- Public read API keys and signed outbound webhooks.
-- The API secret is stored as a SHA-256 hash. The webhook secret is sealed.

CREATE TABLE `api_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `secret_hash` text NOT NULL,
  `prefix` text NOT NULL,
  `scopes` text NOT NULL,
  `created_at` integer NOT NULL,
  `revoked_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `api_keys_secret_hash` ON `api_keys` (`secret_hash`);
CREATE INDEX `api_keys_org` ON `api_keys` (`organization_id`);

CREATE TABLE `webhook_endpoints` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `url` text NOT NULL,
  `events` text NOT NULL,
  `secret` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE INDEX `webhook_endpoints_org` ON `webhook_endpoints` (`organization_id`);

CREATE TABLE `webhook_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `endpoint_id` text NOT NULL,
  `event` text NOT NULL,
  `status` text NOT NULL,
  `response_code` integer,
  `error` text,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE cascade
);

CREATE INDEX `webhook_deliveries_org_created` ON `webhook_deliveries` (`organization_id`, `created_at`);
CREATE INDEX `webhook_deliveries_endpoint` ON `webhook_deliveries` (`endpoint_id`, `created_at`);
