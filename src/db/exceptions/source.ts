import type { ExceptionItem, ExceptionSourceInfo } from "../../domain/exceptions/inbox";
import type { OperatingMode } from "../../domain/operating-mode";
import type { InternalResult } from "../../lib/internal-api";
import type { AppDb } from "../stock";

export type ExceptionSourceContext = {
  db: AppDb;
  organizationId: string;
  warehouseId: string;
  mode: OperatingMode;
  now: number;
};

/** The existing endpoint behind an inline action. It runs in-process as the signed-in user, guards and all. */
export type ExceptionActionCall = {
  path: string;
  body?: unknown;
  /** Why it failed, for endpoints that answer a failure with a 2xx status or with no `error` text. */
  failure?: (result: InternalResult<Record<string, unknown>>) => string | null;
};

/**
 * One kind of problem the inbox gathers. `load` reads the building's problems live from where they
 * already live; nothing about them is copied. A source may return more than `SOURCE_LIMIT`
 * items; the inbox keeps the most pressing ones.
 */
export type ExceptionSource = ExceptionSourceInfo & {
  load(ctx: ExceptionSourceContext): Promise<ExceptionItem[]>;
  action?(item: ExceptionItem, actionId: string): ExceptionActionCall | null;
};

/** A body's `error` text when its `status` says the call failed. */
export function failedStatusError(result: InternalResult<Record<string, unknown>>): string | null {
  if (!result.ok) return result.error;
  if (result.body.status !== "failed") return null;
  return typeof result.body.error === "string" && result.body.error ? result.body.error : "It failed again.";
}
