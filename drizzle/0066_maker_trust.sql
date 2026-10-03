-- Migration number: 0066 	 2026-10-03T17:30:00.000Z
-- Landed freight, QuickBooks bill id, Etsy listing link, exception digest day, and QBO credentials.

ALTER TABLE `purchases` ADD `freight_cents` integer NOT NULL DEFAULT 0;
ALTER TABLE `purchases` ADD `qbo_bill_id` text;
ALTER TABLE `items` ADD `etsy_listing_id` text;
ALTER TABLE `organizations` ADD `exception_digest_ymd` integer;
ALTER TABLE `organizations` ADD `qbo_realm_id` text;
ALTER TABLE `organizations` ADD `qbo_access_token` text;
ALTER TABLE `organizations` ADD `qbo_expense_account_id` text;
