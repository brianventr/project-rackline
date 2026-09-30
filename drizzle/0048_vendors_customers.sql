-- Migration number: 0048 	 2026-09-30T22:30:00.000Z
-- Vendor and customer records. Documents keep their name columns (the name at the time they were
-- made); the new ids link them to the record. Existing names are backfilled, one record per
-- distinct name (case and surrounding spaces ignored).

CREATE TABLE `vendors` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `contact_name` text,
  `email` text,
  `phone` text,
  `address` text,
  `payment_terms` text,
  `lead_time_days` integer,
  `currency` text NOT NULL DEFAULT 'USD',
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `vendors_org_name` ON `vendors` (`organization_id`, lower(trim(`name`)));

CREATE TABLE `customers` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `email` text,
  `phone` text,
  `ship_to_address` text,
  `notes` text,
  `channel_refs_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `customers_org_email` ON `customers` (`organization_id`, lower(trim(`email`))) WHERE `email` IS NOT NULL AND trim(`email`) != '';
CREATE INDEX `customers_org_name` ON `customers` (`organization_id`, lower(trim(`name`)));

ALTER TABLE `purchases` ADD `vendor_id` text REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE `vendor_returns` ADD `vendor_id` text REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE `asns` ADD `vendor_id` text REFERENCES vendors(id) ON DELETE SET NULL;
ALTER TABLE `orders` ADD `customer_id` text REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE `rmas` ADD `customer_id` text REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE `purchase_lines` ADD `unit_cost_cents` integer;

CREATE INDEX `purchases_vendor` ON `purchases` (`vendor_id`);
CREATE INDEX `vendor_returns_vendor` ON `vendor_returns` (`vendor_id`);
CREATE INDEX `asns_vendor` ON `asns` (`vendor_id`);
CREATE INDEX `orders_customer` ON `orders` (`customer_id`);
CREATE INDEX `rmas_customer` ON `rmas` (`customer_id`);

INSERT INTO `vendors` (`id`, `organization_id`, `name`, `currency`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `organization_id`, trim(`vendor_name`), 'USD', min(`created_at`), max(`created_at`)
FROM (
  SELECT `organization_id`, `vendor_name`, `created_at` FROM `purchases`
  UNION ALL SELECT `organization_id`, `vendor_name`, `created_at` FROM `vendor_returns`
  UNION ALL SELECT `organization_id`, `vendor_name`, `created_at` FROM `asns`
)
WHERE trim(`vendor_name`) != ''
GROUP BY `organization_id`, lower(trim(`vendor_name`));

UPDATE `purchases` SET `vendor_id` = (
  SELECT v.`id` FROM `vendors` v
  WHERE v.`organization_id` = `purchases`.`organization_id` AND lower(trim(v.`name`)) = lower(trim(`purchases`.`vendor_name`))
);
UPDATE `vendor_returns` SET `vendor_id` = coalesce(
  (SELECT p.`vendor_id` FROM `purchases` p WHERE p.`id` = `vendor_returns`.`purchase_id`),
  (SELECT v.`id` FROM `vendors` v
   WHERE v.`organization_id` = `vendor_returns`.`organization_id` AND lower(trim(v.`name`)) = lower(trim(`vendor_returns`.`vendor_name`)))
);
UPDATE `asns` SET `vendor_id` = coalesce(
  (SELECT p.`vendor_id` FROM `purchases` p WHERE p.`id` = `asns`.`purchase_id`),
  (SELECT v.`id` FROM `vendors` v
   WHERE v.`organization_id` = `asns`.`organization_id` AND lower(trim(v.`name`)) = lower(trim(`asns`.`vendor_name`)))
);

INSERT INTO `customers` (`id`, `organization_id`, `name`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `organization_id`, trim(`customer_name`), min(`created_at`), max(`created_at`)
FROM (
  SELECT `organization_id`, `customer_name`, `created_at` FROM `orders`
  UNION ALL SELECT `organization_id`, `customer_name`, `created_at` FROM `rmas`
)
WHERE trim(`customer_name`) != ''
GROUP BY `organization_id`, lower(trim(`customer_name`));

UPDATE `customers` SET `ship_to_address` = (
  SELECT o.`ship_to_address` FROM `orders` o
  WHERE o.`organization_id` = `customers`.`organization_id`
    AND lower(trim(o.`customer_name`)) = lower(trim(`customers`.`name`))
    AND trim(coalesce(o.`ship_to_address`, '')) != ''
  ORDER BY o.`created_at` DESC
  LIMIT 1
);

UPDATE `orders` SET `customer_id` = (
  SELECT c.`id` FROM `customers` c
  WHERE c.`organization_id` = `orders`.`organization_id` AND lower(trim(c.`name`)) = lower(trim(`orders`.`customer_name`))
  LIMIT 1
);
UPDATE `rmas` SET `customer_id` = coalesce(
  (SELECT o.`customer_id` FROM `orders` o WHERE o.`id` = `rmas`.`order_id`),
  (SELECT c.`id` FROM `customers` c
   WHERE c.`organization_id` = `rmas`.`organization_id` AND lower(trim(c.`name`)) = lower(trim(`rmas`.`customer_name`))
   LIMIT 1)
);
