-- Migration number: 0050 	 2026-10-01T00:40:00.000Z
-- Bin capacity: an optional limit per bay on units, weight (oz), and volume (cubic inches). A bay
-- with no limits behaves exactly as before.

ALTER TABLE `locations` ADD `max_qty` integer;
ALTER TABLE `locations` ADD `max_weight_oz` integer;
ALTER TABLE `locations` ADD `max_volume_cu_in` integer;
