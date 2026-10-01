-- Migration number: 0054 	 2026-10-01T12:00:00.000Z
-- Customer shipment and delivery emails: per-org notification policy, and one log row per order or return and event.

ALTER TABLE `organizations` ADD `notify_shipped` text NOT NULL DEFAULT 'store';
ALTER TABLE `organizations` ADD `notify_out_for_delivery` text NOT NULL DEFAULT 'store';
ALTER TABLE `organizations` ADD `notify_delivered` text NOT NULL DEFAULT 'store';
ALTER TABLE `organizations` ADD `notify_delivery_exception` text NOT NULL DEFAULT 'store';
ALTER TABLE `organizations` ADD `notify_return_label` text NOT NULL DEFAULT 'store';
ALTER TABLE `organizations` ADD `mail_reply_to` text;
ALTER TABLE `organizations` ADD `mail_sender_name` text;

-- status is sent, skipped, or failed. A repeat of the same event hits the unique index and does not send again.
CREATE TABLE `customer_emails` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `order_id` text,
  `rma_id` text,
  `event` text NOT NULL,
  `recipient` text,
  `status` text NOT NULL,
  `reason` text,
  `provider_id` text,
  `subject` text,
  `text_body` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `sent_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade,
  FOREIGN KEY (`rma_id`) REFERENCES `rmas`(`id`) ON DELETE cascade,
  CHECK ((`order_id` IS NOT NULL AND `rma_id` IS NULL) OR (`order_id` IS NULL AND `rma_id` IS NOT NULL))
);

CREATE UNIQUE INDEX `customer_emails_order_event` ON `customer_emails` (`order_id`, `event`) WHERE `order_id` IS NOT NULL;
CREATE UNIQUE INDEX `customer_emails_rma_event` ON `customer_emails` (`rma_id`, `event`) WHERE `rma_id` IS NOT NULL;
CREATE INDEX `customer_emails_org_status` ON `customer_emails` (`organization_id`, `status`, `updated_at`);
