-- Migration number: 0001 	 2026-09-18T20:00:00.000Z

CREATE TABLE `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `emailVerified` integer NOT NULL,
  `image` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);

CREATE TABLE `session` (
  `id` text PRIMARY KEY NOT NULL,
  `expiresAt` integer NOT NULL,
  `token` text NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `ipAddress` text,
  `userAgent` text,
  `userId` text NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
CREATE INDEX `session_userId_idx` ON `session` (`userId`);

CREATE TABLE `account` (
  `id` text PRIMARY KEY NOT NULL,
  `accountId` text NOT NULL,
  `providerId` text NOT NULL,
  `userId` text NOT NULL,
  `accessToken` text,
  `refreshToken` text,
  `idToken` text,
  `accessTokenExpiresAt` integer,
  `refreshTokenExpiresAt` integer,
  `scope` text,
  `password` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE cascade
);

CREATE TABLE `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expiresAt` integer NOT NULL,
  `createdAt` integer,
  `updatedAt` integer
);

CREATE TABLE `organizations` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `memberships_org_user` ON `memberships` (`organization_id`, `user_id`);

CREATE TABLE `warehouses` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `name` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);

CREATE TABLE `locations` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `locations_org_wh_code` ON `locations` (`organization_id`, `warehouse_id`, `code`);

CREATE TABLE `items` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `sku` text NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `items_org_sku` ON `items` (`organization_id`, `sku`);

CREATE TABLE `inventory_balances` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `location_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `balances_org_loc_item` ON `inventory_balances` (`organization_id`, `location_id`, `item_id`);

CREATE TABLE `inventory_movements` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `type` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `from_location_id` text,
  `to_location_id` text,
  `ref_type` text NOT NULL,
  `ref_id` text NOT NULL,
  `reason` text,
  `created_at` integer NOT NULL,
  `created_by` text NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
CREATE INDEX `movements_org_created` ON `inventory_movements` (`organization_id`, `created_at`);

CREATE TABLE `receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `status` text NOT NULL,
  `location_id` text,
  `notes` text,
  `created_at` integer NOT NULL,
  `received_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
);

CREATE TABLE `receipt_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `receipt_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);

CREATE TABLE `orders` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `customer_name` text NOT NULL,
  `status` text NOT NULL,
  `pick_location_id` text,
  `created_at` integer NOT NULL,
  `picked_at` integer,
  `shipped_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`)
);

CREATE TABLE `order_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `order_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);

CREATE TABLE `boms` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `item_id` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `boms_org_item` ON `boms` (`organization_id`, `item_id`);

CREATE TABLE `bom_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `bom_id` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  FOREIGN KEY (`bom_id`) REFERENCES `boms`(`id`) ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
CREATE UNIQUE INDEX `bom_lines_bom_item` ON `bom_lines` (`bom_id`, `item_id`);

CREATE TABLE `work_orders` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `warehouse_id` text NOT NULL,
  `number` text NOT NULL,
  `item_id` text NOT NULL,
  `qty` integer NOT NULL,
  `status` text NOT NULL,
  `source_location_id` text NOT NULL,
  `output_location_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
  FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`),
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`),
  FOREIGN KEY (`source_location_id`) REFERENCES `locations`(`id`),
  FOREIGN KEY (`output_location_id`) REFERENCES `locations`(`id`)
);
