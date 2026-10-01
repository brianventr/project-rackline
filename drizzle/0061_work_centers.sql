-- Migration number: 0061 	 2026-10-01T20:30:00.000Z
-- Work centers name where a recipe step is done. A child work order covers a short made component.
-- Stock stays on the one ledger.

CREATE TABLE `work_centers` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `work_centers_org_code` ON `work_centers` (`organization_id`, `code`);

ALTER TABLE `bom_steps` ADD `work_center_id` text REFERENCES `work_centers`(`id`) ON DELETE set null;

ALTER TABLE `work_orders` ADD `parent_work_order_id` text REFERENCES `work_orders`(`id`) ON DELETE set null;

CREATE INDEX `work_orders_parent` ON `work_orders` (`parent_work_order_id`);
