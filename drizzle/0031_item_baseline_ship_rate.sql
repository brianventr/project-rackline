-- Migration number: 0031 	 2026-09-21T15:05:00.000Z
-- Optional SKU baseline shipping rate (units / day) for Analytics → Runway.

ALTER TABLE `items` ADD `baseline_ship_rate` real;
