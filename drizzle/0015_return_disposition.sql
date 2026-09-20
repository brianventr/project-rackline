-- Migration number: 0015 	 2026-09-20T13:20:00.000Z

ALTER TABLE `rma_lines` ADD `disposition` text NOT NULL DEFAULT 'restock';
