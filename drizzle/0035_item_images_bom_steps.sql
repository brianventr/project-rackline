-- Migration number: 0035 	 2026-09-21T23:15:00.000Z
-- SKU photos and numbered kitting steps on the recipe.

ALTER TABLE `items` ADD `image_url` text;
--> statement-breakpoint
CREATE TABLE `bom_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `bom_id` text NOT NULL,
  `seq` integer NOT NULL,
  `title` text NOT NULL DEFAULT '',
  `body` text NOT NULL DEFAULT '',
  `image_url` text,
  `component_item_id` text,
  FOREIGN KEY (`bom_id`) REFERENCES `boms`(`id`) ON DELETE cascade,
  FOREIGN KEY (`component_item_id`) REFERENCES `items`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bom_steps_bom_seq` ON `bom_steps` (`bom_id`, `seq`);
