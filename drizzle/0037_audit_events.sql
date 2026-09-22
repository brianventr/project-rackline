-- Migration number: 0037 	 2026-09-22T04:00:00.000Z
-- Append-only user audit: who posted which mutation, 409, or owner override.

CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text,
	`actor_email` text DEFAULT '' NOT NULL,
	`actor_name` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`code` text,
	`summary` text DEFAULT '' NOT NULL,
	`payload_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `audit_events_org_created` ON `audit_events` (`organization_id`,`created_at`);
CREATE INDEX `audit_events_org_code` ON `audit_events` (`organization_id`,`code`);
