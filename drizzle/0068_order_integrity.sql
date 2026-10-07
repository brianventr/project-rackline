-- Migration number: 0068 	 2026-10-07T14:30:00.000Z
-- Shopify order signals for SKU gaps, unpaid waits, and cancels that stay open.

CREATE TABLE `shopify_order_signals` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `shopify_order_id` text NOT NULL,
  `shopify_order_name` text,
  `kind` text NOT NULL,
  `sku` text NOT NULL DEFAULT '',
  `payload_json` text,
  `received_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `shopify_order_signals_key` ON `shopify_order_signals` (`organization_id`, `shopify_order_id`, `kind`, `sku`);
CREATE INDEX `shopify_order_signals_org_kind` ON `shopify_order_signals` (`organization_id`, `kind`, `received_at`);
