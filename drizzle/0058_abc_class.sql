-- Migration number: 0058 	 2026-10-01T16:00:00.000Z
-- ABC class from recent pick and ship movement. Cadence lives in the planner, not a second count type.

ALTER TABLE `items` ADD `abc_class` text;
ALTER TABLE `items` ADD `abc_units` integer NOT NULL DEFAULT 0;
ALTER TABLE `items` ADD `abc_classified_at` integer;
