-- Migration number: 0065 	 2026-10-02T06:50:00.000Z
-- Automation map: replenish mode, starved pick faces, open-document reminders, and reorder alerts.
-- Null keeps the previous behavior (suggest only, no extra exceptions).

ALTER TABLE `organizations` ADD `automation_policy` text;
