-- Migration number: 0024 	 2026-09-20T18:50:00.000Z
-- PIT registry, operator certs, exclusive checkout, OSHA pre-use inspections, ledger stamp.

CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`class` text NOT NULL,
	`barcode` text NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `equipment_org_wh_code` ON `equipment` (`organization_id`, `warehouse_id`, `code`);
CREATE UNIQUE INDEX `equipment_org_barcode` ON `equipment` (`organization_id`, `barcode`);

CREATE TABLE `operator_certifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`class` text NOT NULL,
	`expires_on` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `operator_certs_org_user_class` ON `operator_certifications` (`organization_id`, `user_id`, `class`);

CREATE TABLE `equipment_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`number` text NOT NULL,
	`equipment_id` text NOT NULL,
	`operator_user_id` text NOT NULL,
	`status` text NOT NULL,
	`shift` text,
	`ref_type` text,
	`ref_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`started_by` text NOT NULL,
	`ended_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operator_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `equipment_assignments_org_number` ON `equipment_assignments` (`organization_id`, `number`);
CREATE INDEX `equipment_assignments_org_equipment` ON `equipment_assignments` (`organization_id`, `equipment_id`, `started_at`);
CREATE INDEX `equipment_assignments_org_operator` ON `equipment_assignments` (`organization_id`, `operator_user_id`, `started_at`);
CREATE UNIQUE INDEX `equipment_assignments_open_equipment` ON `equipment_assignments` (`equipment_id`) WHERE `status` = 'open';
CREATE UNIQUE INDEX `equipment_assignments_open_operator` ON `equipment_assignments` (`organization_id`, `operator_user_id`) WHERE `status` = 'open';

CREATE TABLE `equipment_inspections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`assignment_id` text,
	`result` text NOT NULL,
	`items_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignment_id`) REFERENCES `equipment_assignments`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `equipment_inspections_org_equipment` ON `equipment_inspections` (`organization_id`, `equipment_id`, `created_at`);

CREATE TABLE `equipment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`assignment_id` text,
	`type` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`payload_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `equipment_events_org_equipment` ON `equipment_events` (`organization_id`, `equipment_id`, `created_at`);

ALTER TABLE `inventory_movements` ADD `equipment_id` text;
ALTER TABLE `inventory_movements` ADD `assignment_id` text;
CREATE INDEX `inventory_movements_equipment` ON `inventory_movements` (`equipment_id`);
CREATE INDEX `inventory_movements_assignment` ON `inventory_movements` (`assignment_id`);
