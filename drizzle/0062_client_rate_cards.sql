-- Migration number: 0062 	 2026-10-01T20:00:00.000Z
-- Per-client rate card and a read-only portal token.
-- Null rate columns mean the organization rate. Null portal_token means the portal is off.

ALTER TABLE `clients` ADD `storage_cents_per_piece` integer;
ALTER TABLE `clients` ADD `pick_cents_per_unit` integer;
ALTER TABLE `clients` ADD `carton_cents` integer;
ALTER TABLE `clients` ADD `portal_token` text;

CREATE UNIQUE INDEX `clients_portal_token` ON `clients` (`portal_token`);
