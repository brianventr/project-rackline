-- Migration number: 0006 	 2026-09-19T12:00:00.000Z

ALTER TABLE `order_lines` ADD `qty_picked` integer NOT NULL DEFAULT 0;
