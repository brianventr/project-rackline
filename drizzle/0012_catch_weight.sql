-- Migration number: 0012 	 2026-09-20T03:20:00.000Z

ALTER TABLE `items` ADD `catch_weight` integer NOT NULL DEFAULT 0;
ALTER TABLE `inventory_movements` ADD `weight_grams` integer;
ALTER TABLE `cycle_count_lines` ADD `weight_grams` integer;
