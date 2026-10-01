-- Migration number: 0047 	 2026-10-01T09:00:00.000Z
-- Customer shipping: the public tracking page and its branding, return labels, customs data, and address checks.

-- Tracking page branding. Both optional; the page falls back to the shop name in the default colour.
ALTER TABLE `organizations` ADD `brand_color` text;
ALTER TABLE `organizations` ADD `logo_url` text;

-- Where customer return labels are addressed. Null means the ship-from address.
ALTER TABLE `warehouses` ADD `return_address` text;

-- Customs declaration per item. The description falls back to the item name.
ALTER TABLE `items` ADD `hs_code` text;
ALTER TABLE `items` ADD `origin_country` text;
ALTER TABLE `items` ADD `customs_description` text;
ALTER TABLE `items` ADD `customs_value_cents` integer;

-- The unguessable token behind /t/:token, and the carrier's customs form printed with the label.
ALTER TABLE `orders` ADD `tracking_token` text;
ALTER TABLE `orders` ADD `customs_form_url` text;
CREATE UNIQUE INDEX `orders_tracking_token` ON `orders` (`tracking_token`);
ALTER TABLE `order_packages` ADD `customs_form_url` text;

-- The tracking page reads an order's tracker history by tracking number.
CREATE INDEX `tracker_webhook_receipts_org_tracking` ON `tracker_webhook_receipts` (`organization_id`, `tracking_number`, `created_at`);

CREATE TABLE `return_labels` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `rma_id` text NOT NULL,
  `token` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `carrier_connection_id` text,
  `carrier_company` text NOT NULL,
  `carrier_service` text NOT NULL,
  `tracking_number` text NOT NULL,
  `tracking_url` text,
  `label_url` text,
  `carrier_shipment_id` text,
  `carrier_label_id` text,
  `postage_cents` integer,
  `tracker_status` text,
  `tracker_updated_at` integer,
  `from_name` text NOT NULL,
  `from_address` text NOT NULL,
  `to_name` text NOT NULL,
  `to_address` text NOT NULL,
  `weight_oz` integer,
  `length_in` integer,
  `width_in` integer,
  `height_in` integer,
  `created_by` text,
  `created_at` integer NOT NULL,
  `voided_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`rma_id`) REFERENCES `rmas`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `return_labels_token` ON `return_labels` (`token`);
CREATE INDEX `return_labels_rma` ON `return_labels` (`rma_id`);
CREATE INDEX `return_labels_org_tracking` ON `return_labels` (`organization_id`, `tracking_number`);

-- One row per order and ship-to address: the carrier's verification answer, and the owner's
-- "ship anyway" override. A changed address hashes differently, so neither carries over to it.
CREATE TABLE `address_checks` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `order_id` text NOT NULL,
  `address_hash` text NOT NULL,
  `provider` text,
  `status` text NOT NULL,
  `message` text,
  `suggestion_json` text,
  `override_by` text,
  `override_at` integer,
  `checked_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `address_checks_order_hash` ON `address_checks` (`order_id`, `address_hash`);
