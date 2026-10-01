-- Migration number: 0064 	 2026-10-01T22:30:00.000Z
-- Restock forecast: vendor make and transit lanes, an org policy, and ASN freight milestones.
-- A vendor with no transit mode keeps the existing runway lead. Null policy columns stay unset.

ALTER TABLE `organizations` ADD `restock_policy` text NOT NULL DEFAULT 'alert';

ALTER TABLE `vendors` ADD `make_days` integer;
ALTER TABLE `vendors` ADD `transit_mode` text;
ALTER TABLE `vendors` ADD `transit_days` integer;
ALTER TABLE `vendors` ADD `buffer_days` integer;

ALTER TABLE `items` ADD `make_days` integer;

ALTER TABLE `asns` ADD `container_number` text;
ALTER TABLE `asns` ADD `departed_at` integer;
ALTER TABLE `asns` ADD `milestone` text;
