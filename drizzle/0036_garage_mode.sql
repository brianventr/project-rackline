-- Migration number: 0036 	 2026-09-21T23:40:00.000Z
-- Garage Mode is the founder bench. Existing organizations stay on the full warehouse.

ALTER TABLE `organizations` ADD `operating_mode` text NOT NULL DEFAULT 'warehouse';
