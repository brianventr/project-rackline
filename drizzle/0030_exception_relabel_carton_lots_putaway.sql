-- Migration number: 0030 	 2026-09-21T05:10:00.000Z
-- Tracker exception relabel, vendor carton lots, and carton putaway.

ALTER TABLE `asn_packages` ADD `putaway_at` integer;
--> statement-breakpoint
ALTER TABLE `asn_package_lines` ADD `lot_code` text;
--> statement-breakpoint
ALTER TABLE `asn_package_lines` ADD `serials_json` text;
--> statement-breakpoint
ALTER TABLE `asn_package_lines` ADD `weight_grams` integer;
--> statement-breakpoint
ALTER TABLE `asn_package_lines` ADD `expires_on` integer;
