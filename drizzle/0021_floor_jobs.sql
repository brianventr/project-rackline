-- Migration number: 0021 	 2026-09-20T18:50:00.000Z

ALTER TABLE `memberships` ADD `floor_verbs` text;
--> statement-breakpoint
CREATE TABLE `floor_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `verb` text NOT NULL,
  `ref_type` text NOT NULL,
  `ref_id` text NOT NULL,
  `status` text NOT NULL,
  `number` text,
  `title` text,
  `assignee_id` text,
  `claimed_at` integer,
  `released_at` integer,
  `done_at` integer,
  `not_before` integer,
  `due_at` integer,
  `pinned` integer NOT NULL DEFAULT 0,
  `from_location_id` text,
  `to_location_id` text,
  `item_id` text,
  `qty` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON DELETE set null,
  FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON DELETE set null,
  FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON DELETE set null,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `floor_jobs_org_wh_status` ON `floor_jobs` (`organization_id`,`warehouse_id`,`status`);
--> statement-breakpoint
CREATE INDEX `floor_jobs_org_ref` ON `floor_jobs` (`organization_id`,`ref_type`,`ref_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `floor_jobs_open_ref` ON `floor_jobs` (`organization_id`,`ref_type`,`ref_id`,`verb`) WHERE `status` IN ('open', 'claimed');
