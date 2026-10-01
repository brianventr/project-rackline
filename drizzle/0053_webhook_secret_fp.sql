-- Migration number: 0053 	 2026-10-01T12:00:00.000Z
-- Carrier tracker webhook secrets are sealed in webhook_secret. This fingerprint is the non-secret
-- lookup for the connection that owns one, so verification opens that secret and no others.

ALTER TABLE `carrier_connections` ADD `webhook_secret_fp` text;
CREATE INDEX `carrier_connections_webhook_fp` ON `carrier_connections` (`webhook_secret_fp`);
