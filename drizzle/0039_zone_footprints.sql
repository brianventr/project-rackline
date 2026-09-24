-- Migration number: 0039 	 2026-09-24T14:00:00.000Z
-- Zones can be drawn on the floor in Build floor. A zero size keeps a zone as the tag it was.

ALTER TABLE `zones` ADD `pos_x` integer NOT NULL DEFAULT 0;
ALTER TABLE `zones` ADD `pos_y` integer NOT NULL DEFAULT 0;
ALTER TABLE `zones` ADD `size_x` integer NOT NULL DEFAULT 0;
ALTER TABLE `zones` ADD `size_y` integer NOT NULL DEFAULT 0;
