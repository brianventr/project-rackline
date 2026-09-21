-- Migration number: 0029 	 2026-09-21T04:30:00.000Z
-- Shopify carton tracking, tracker exceptions, inbound ASN cartons.

CREATE TABLE `asn_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`asn_id` text NOT NULL,
	`number` text NOT NULL,
	`seq` integer NOT NULL,
	`sscc` text,
	`received_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`asn_id`) REFERENCES `asns`(`id`) ON DELETE cascade
);
CREATE UNIQUE INDEX `asn_packages_asn_number` ON `asn_packages` (`asn_id`, `number`);
CREATE UNIQUE INDEX `asn_packages_org_sscc` ON `asn_packages` (`organization_id`, `sscc`);

CREATE TABLE `asn_package_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`asn_line_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `asn_packages`(`id`) ON DELETE cascade,
	FOREIGN KEY (`asn_line_id`) REFERENCES `asn_lines`(`id`) ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
CREATE UNIQUE INDEX `asn_package_lines_pkg_line` ON `asn_package_lines` (`package_id`, `asn_line_id`);
