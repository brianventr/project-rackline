-- Migration number: 0034 	 2026-09-21T20:00:00.000Z
-- Purchase mail provider id, and per-client activity invoice lines.

ALTER TABLE `purchase_sends` ADD `provider_id` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `client_id` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `lines_json` text NOT NULL DEFAULT '[]';
