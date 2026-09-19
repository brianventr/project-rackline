-- Migration number: 0009 	 2026-09-19T20:40:00.000Z

ALTER TABLE `cycle_count_lines` ADD `entered` integer NOT NULL DEFAULT 0;

UPDATE `cycle_count_lines`
SET `entered` = 1
WHERE `cycle_count_id` IN (
  SELECT `id` FROM `cycle_counts` WHERE `status` = 'posted'
);
