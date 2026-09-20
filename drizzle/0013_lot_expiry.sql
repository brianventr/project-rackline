-- Migration number: 0013 	 2026-09-20T12:00:00.000Z

ALTER TABLE `items` ADD `track_expiry` integer NOT NULL DEFAULT 0;
ALTER TABLE `lot_balances` ADD `expires_on` integer;
ALTER TABLE `inventory_movements` ADD `expires_on` integer;
