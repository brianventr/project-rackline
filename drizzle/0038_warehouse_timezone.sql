-- Migration number: 0038 	 2026-09-22T21:10:00.000Z
-- Live uses the building's local midnight. Existing rows stay UTC until an owner sets a zone.

ALTER TABLE `warehouses` ADD `time_zone` text NOT NULL DEFAULT 'UTC';
