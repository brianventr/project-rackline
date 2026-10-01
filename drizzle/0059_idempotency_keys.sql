-- Migration number: 0059 	 2026-10-01T18:00:00.000Z
-- Client idempotency keys for floor receive and pick. Replaying a key returns the stored outcome.

CREATE TABLE `idempotency_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `user_id` text NOT NULL,
  `key` text NOT NULL,
  `response_status` integer NOT NULL,
  `response_json` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);

CREATE UNIQUE INDEX `idempotency_keys_org_key` ON `idempotency_keys` (`organization_id`, `key`);
