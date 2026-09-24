-- Migration number: 0040 	 2026-09-24T15:00:00.000Z
-- Every floor map carries a compass. North defaults to the top edge, which is how the maps were drawn so far.

ALTER TABLE `warehouses` ADD `map_north` integer NOT NULL DEFAULT 0;
