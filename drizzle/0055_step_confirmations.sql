-- Migration number: 0055 	 2026-10-01T15:20:00.000Z
-- Recipe step confirmations for a kit build or work order. Qty counts toward the units being completed.

CREATE TABLE `step_confirmations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `ref_type` text NOT NULL,
  `ref_id` text NOT NULL,
  `step_id` text NOT NULL,
  `qty` integer NOT NULL,
  `code` text,
  `confirmed_by` text,
  `confirmed_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`step_id`) REFERENCES `bom_steps`(`id`) ON DELETE cascade
);

CREATE INDEX `step_confirmations_ref` ON `step_confirmations` (`organization_id`, `ref_type`, `ref_id`);
