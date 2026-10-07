-- Migration number: 0067 	 2026-10-07T05:00:00.000Z
-- Serial registry links, warranty, replacement, return grade and photos, event outbox, Klaviyo.

ALTER TABLE `items` ADD `warranty_months` integer;
ALTER TABLE `items` ADD `refurb_item_id` text;

ALTER TABLE `orders` ADD `backer_id` text;

ALTER TABLE `organizations` ADD `klaviyo_mode` text NOT NULL DEFAULT 'demo';
ALTER TABLE `organizations` ADD `klaviyo_private_key` text;

ALTER TABLE `rma_lines` ADD `condition` text;
ALTER TABLE `rma_lines` ADD `grade` text;
ALTER TABLE `rma_lines` ADD `serial` text;

ALTER TABLE `clients` ADD `return_cents` integer;

CREATE UNIQUE INDEX `serials_org_code` ON `serials` (`organization_id`, `serial_code`);

CREATE TABLE `serial_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `serial_id` text NOT NULL,
  `order_id` text NOT NULL,
  `order_line_id` text NOT NULL,
  `package_id` text,
  `scanned_by` text,
  `scanned_at` integer NOT NULL,
  `shipped_at` integer,
  `tracking_number` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`serial_id`) REFERENCES `serials`(`id`) ON DELETE cascade,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade,
  FOREIGN KEY (`order_line_id`) REFERENCES `order_lines`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `serial_assignments_serial` ON `serial_assignments` (`serial_id`);
CREATE INDEX `serial_assignments_order` ON `serial_assignments` (`order_id`);

CREATE TABLE `warranties` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `serial_id` text NOT NULL,
  `start_at` integer,
  `end_at` integer,
  `status` text NOT NULL,
  `term_months` integer,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`serial_id`) REFERENCES `serials`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `warranties_serial` ON `warranties` (`serial_id`);

CREATE TABLE `replacement_links` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `original_serial_id` text NOT NULL,
  `new_serial_id` text,
  `claim_reference` text NOT NULL,
  `replacement_order_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`original_serial_id`) REFERENCES `serials`(`id`) ON DELETE cascade,
  FOREIGN KEY (`new_serial_id`) REFERENCES `serials`(`id`) ON DELETE set null,
  FOREIGN KEY (`replacement_order_id`) REFERENCES `orders`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `replacement_links_original` ON `replacement_links` (`original_serial_id`);
CREATE INDEX `replacement_links_order` ON `replacement_links` (`replacement_order_id`);

CREATE TABLE `rma_photos` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `rma_id` text NOT NULL,
  `url` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`rma_id`) REFERENCES `rmas`(`id`) ON DELETE cascade
);
CREATE INDEX `rma_photos_rma` ON `rma_photos` (`rma_id`);

CREATE TABLE `event_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `destination` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_json` text NOT NULL,
  `attempts` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL,
  `last_error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `event_outbox_idem` ON `event_outbox` (`organization_id`, `idempotency_key`);
CREATE INDEX `event_outbox_status` ON `event_outbox` (`organization_id`, `status`);
