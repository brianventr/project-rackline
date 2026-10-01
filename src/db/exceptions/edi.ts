import { and, asc, eq, gt, gte, notExists, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { EDI_SOURCE, EDI_WINDOW_MS, ediProblems } from "../../domain/exceptions/edi";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

/**
 * A field of a stored ASN body. Refused bodies are kept as sent, so it may hold any JSON value; a body
 * that is not JSON reads as null rather than failing the whole query.
 */
function field(payloadJson: SQLWrapper, path: "$.vendorName" | "$.reference") {
  return sql`case when json_valid(${payloadJson}) then json_extract(${payloadJson}, ${path}) end`;
}

function sameAsn(a: SQLWrapper, b: SQLWrapper) {
  return and(
    sql`lower(trim(${field(a, "$.vendorName")})) = lower(trim(${field(b, "$.vendorName")}))`,
    sql`coalesce(trim(${field(a, "$.reference")}), '') = coalesce(trim(${field(b, "$.reference")}), '')`,
  );
}

export const ediSource: ExceptionSource = {
  ...EDI_SOURCE,
  async load({ db, organizationId, now }) {
    const inbox = schema.ediInbox;
    const later = alias(schema.ediInbox, "later_edi");
    const rows = await db
      .select({
        id: inbox.id,
        error: inbox.error,
        createdAt: inbox.createdAt,
        vendorName: field(inbox.payloadJson, "$.vendorName"),
        reference: field(inbox.payloadJson, "$.reference"),
      })
      .from(inbox)
      .where(
        and(
          eq(inbox.organizationId, organizationId),
          eq(inbox.status, "failed"),
          gte(inbox.createdAt, now - EDI_WINDOW_MS),
          notExists(
            db
              .select({ id: later.id })
              .from(later)
              .where(
                and(
                  eq(later.organizationId, organizationId),
                  eq(later.status, "processed"),
                  gt(later.createdAt, inbox.createdAt),
                  sameAsn(later.payloadJson, inbox.payloadJson),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(inbox.createdAt))
      .limit(SOURCE_LIMIT + 1);
    return ediProblems(rows);
  },
};
