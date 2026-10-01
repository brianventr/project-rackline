-- Migration number: 0056 	 2026-10-01T15:40:00.000Z
-- Optional QC sample percent on an item, and the sampled units from a receipt line.

ALTER TABLE `items` ADD `qc_sample_percent` integer;

-- status is open, restocked, held, or scrapped. Open units are on hand and not available.
CREATE TABLE `receipt_qc_samples` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `receipt_id` text NOT NULL,
  `receipt_line_id` text NOT NULL,
  `item_id` text NOT NULL,
  `location_id` text NOT NULL,
  `qty` integer NOT NULL,
  `status` text NOT NULL,
  `photo_url` text,
  `decided_by` text,
  `decided_at` integer,
  `hold_id` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE cascade,
  FOREIGN KEY (`receipt_line_id`) REFERENCES `receipt_lines`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`),
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`),
  FOREIGN KEY (`hold_id`) REFERENCES `inventory_holds`(`id`) ON DELETE set null
);

CREATE INDEX `receipt_qc_samples_receipt` ON `receipt_qc_samples` (`receipt_id`, `status`);
CREATE INDEX `receipt_qc_samples_open` ON `receipt_qc_samples` (`organization_id`, `status`);
