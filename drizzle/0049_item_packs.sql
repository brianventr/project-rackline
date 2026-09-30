-- Migration number: 0049 	 2026-09-30T23:20:00.000Z
-- Pack sizes: the inner, case, and pallet an item comes in. Stock stays in eaches; a pack is a
-- multiple with its own barcode, weight, and size. Items whose alt unit is already named inner, case,
-- or pallet get that level.

CREATE TABLE `item_packs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `item_id` text NOT NULL,
  `level` text NOT NULL,
  `qty` integer NOT NULL,
  `barcode` text,
  `weight_oz` integer,
  `length_in` integer,
  `width_in` integer,
  `height_in` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `item_packs_item_level` ON `item_packs` (`item_id`, `level`);
CREATE UNIQUE INDEX `item_packs_org_barcode` ON `item_packs` (`organization_id`, `barcode`) WHERE `barcode` IS NOT NULL;

INSERT INTO `item_packs` (`id`, `organization_id`, `item_id`, `level`, `qty`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `organization_id`, `id`, lower(trim(`alt_uom`)), `alt_per_stock`, `created_at`, `created_at`
FROM `items`
WHERE lower(trim(`alt_uom`)) IN ('inner', 'case', 'pallet') AND `alt_per_stock` > 1;
