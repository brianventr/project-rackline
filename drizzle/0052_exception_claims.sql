-- Migration number: 0052 	 2026-10-01T09:00:00.000Z
-- Exception inbox: who has claimed, snoozed, or resolved each problem. The problems themselves are
-- derived live from their sources (orders, holds, trackers...), so a row here only holds that state,
-- keyed by the source and the source's own key. A row whose problem has cleared is simply never read.

CREATE TABLE `exception_claims` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text,
  `source` text NOT NULL,
  `key` text NOT NULL,
  `claimed_by` text,
  `claimed_at` integer,
  `snoozed_until` integer,
  `resolved_at` integer,
  `resolved_by` text,
  `resolution_note` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `exception_claims_org_source_key` ON `exception_claims` (`organization_id`, `source`, `key`);
CREATE INDEX `exception_claims_org_key` ON `exception_claims` (`organization_id`, `key`);
