-- Migration number: 0053 	 2026-10-01T12:00:00.000Z
-- Carrier tracker webhook secrets are sealed in webhook_secret. This fingerprint is the non-secret
-- lookup for the connection that owns one, so verification opens that secret and no others.

ALTER TABLE `carrier_connections` ADD `webhook_secret_fp` text;
CREATE INDEX `carrier_connections_webhook_fp` ON `carrier_connections` (`webhook_secret_fp`);

-- Manufacturer floor scan sessions. The server records each scan; pick, pack, and batch pick
-- check this list instead of scans a client claims in the post body. Item scans are marked
-- consumed when a post accepts them; the bay scan stays for the next post at that task.

CREATE TABLE `floor_scan_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text,
  `user_id` text NOT NULL,
  `task` text NOT NULL,
  `ref_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
CREATE INDEX `floor_scan_sessions_org_task` ON `floor_scan_sessions` (`organization_id`, `user_id`, `task`, `ref_id`);

CREATE TABLE `floor_scans` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `client_scan_id` text NOT NULL,
  `kind` text NOT NULL,
  `code` text NOT NULL,
  `sku` text,
  `serial` text,
  `location_id` text,
  `location_code` text,
  `consumed_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `floor_scan_sessions`(`id`) ON DELETE cascade,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `floor_scans_session_client` ON `floor_scans` (`session_id`, `client_scan_id`);
CREATE INDEX `floor_scans_session_serial` ON `floor_scans` (`session_id`, `serial`);
