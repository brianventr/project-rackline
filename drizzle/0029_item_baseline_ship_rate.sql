-- Migration number: 0029 	 2026-09-21T05:00:00.000Z
-- Optional SKU baseline shipping rate (units / day) for Analytics → Runway.

ALTER TABLE `items` ADD `baseline_ship_rate` real;
