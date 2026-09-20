-- Printer registry, print stations, and print job audit.
CREATE TABLE `printers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`connection` text DEFAULT 'browser' NOT NULL,
	`media` text DEFAULT 'letter' NOT NULL,
	`dpi` integer DEFAULT 203 NOT NULL,
	`qz_printer_name` text,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `printers_org` ON `printers` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `print_stations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`warehouse_id` text,
	`default_printer_id` text,
	`bay_printer_id` text,
	`shipping_printer_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`default_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bay_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`shipping_printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `print_stations_org` ON `print_stations` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`printer_id` text,
	`station_id` text,
	`kind` text NOT NULL,
	`payload_format` text NOT NULL,
	`status` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`station_id`) REFERENCES `print_stations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `print_jobs_org_created` ON `print_jobs` (`organization_id`,`created_at`);
