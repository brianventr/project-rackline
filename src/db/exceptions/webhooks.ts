import { and, asc, eq, gt, gte, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { RESEND_WEBHOOK, WEBHOOK_SOURCE, WEBHOOK_WINDOW_MS, webhookProblems, webhookResendPath } from "../../domain/exceptions/webhooks";
import { SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import * as schema from "../schema";
import { failedStatusError, type ExceptionSource } from "./source";

export const webhookSource: ExceptionSource = {
  ...WEBHOOK_SOURCE,
  loadLimit: SOURCE_LIMIT + 1,
  async load({ db, organizationId, now }) {
    const delivery = schema.webhookDeliveries;
    const later = alias(schema.webhookDeliveries, "later_webhook");
    const rows = await db
      .select({
        id: delivery.id,
        event: delivery.event,
        error: delivery.error,
        responseCode: delivery.responseCode,
        createdAt: delivery.createdAt,
        url: schema.webhookEndpoints.url,
      })
      .from(delivery)
      .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, delivery.endpointId))
      .where(
        and(
          eq(delivery.organizationId, organizationId),
          eq(delivery.status, "failed"),
          gte(delivery.createdAt, now - WEBHOOK_WINDOW_MS),
          notExists(
            db
              .select({ id: later.id })
              .from(later)
              .where(
                and(
                  eq(later.endpointId, delivery.endpointId),
                  eq(later.event, delivery.event),
                  eq(later.payloadJson, delivery.payloadJson),
                  gt(later.createdAt, delivery.createdAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(delivery.createdAt))
      .limit(SOURCE_LIMIT + 1);
    return webhookProblems(rows);
  },
  action(item, actionId) {
    if (actionId !== RESEND_WEBHOOK.id) return null;
    const path = webhookResendPath(item.key);
    if (!path) return null;
    return { path, failure: failedStatusError };
  },
};
