import { and, eq, inArray } from "drizzle-orm";
import {
  orderCreatedPayload,
  orderShippedPayload,
  serializeWebhookPayload,
  signWebhookBody,
  stockChangedPayload,
  storedEvents,
  type WebhookEventName,
  type WebhookPayload,
} from "../domain/webhooks";
import { newId } from "../lib/ids";
import { channelSecret, openSecret } from "../lib/secret-box";
import { currentRequestScope } from "../lib/request-scope";
import type { Bindings } from "../lib/types";
import * as schema from "./schema";
import type { AppDb } from "./stock";

export type OutboundEvent = { event: WebhookEventName; payload: WebhookPayload };

const DELIVER_MS = 8_000;

export type DeliveryResult = { ok: boolean; responseCode: number | null; error: string | null };

function deliveryError(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? err.cause.message : "";
    const text = cause ? `${err.message}: ${cause}` : err.message;
    return text.slice(0, 500);
  }
  return "Delivery failed";
}

/** POST the raw body and sign it the way a receiver will check `Rackline-Signature`. */
export async function postSignedWebhook(input: { url: string; secret: string; body: string }): Promise<DeliveryResult> {
  const signature = await signWebhookBody(input.secret, input.body);
  try {
    const response = await fetch(input.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVER_MS),
      headers: {
        "content-type": "application/json",
        "Rackline-Signature": signature,
        "user-agent": "Rackline",
      },
      body: input.body,
    });
    if (response.status >= 200 && response.status < 300) return { ok: true, responseCode: response.status, error: null };
    return { ok: false, responseCode: response.status, error: `Receiver responded ${response.status}` };
  } catch (err) {
    return { ok: false, responseCode: null, error: deliveryError(err) };
  }
}

async function insertDelivery(
  db: AppDb,
  row: {
    organizationId: string;
    endpointId: string;
    event: string;
    status: "delivered" | "failed";
    responseCode: number | null;
    error: string | null;
    payloadJson: string;
  },
) {
  await db.insert(schema.webhookDeliveries).values({
    id: newId(),
    organizationId: row.organizationId,
    endpointId: row.endpointId,
    event: row.event,
    status: row.status,
    responseCode: row.responseCode,
    error: row.error,
    payloadJson: row.payloadJson,
    createdAt: Date.now(),
  });
}

export async function deliverOutbound(db: AppDb, env: Bindings | undefined, organizationId: string, events: OutboundEvent[]): Promise<void> {
  if (events.length === 0) return;
  const endpoints = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.organizationId, organizationId), eq(schema.webhookEndpoints.enabled, true)));
  if (endpoints.length === 0) return;
  let secretKey: string;
  try {
    secretKey = channelSecret(env ?? {});
  } catch (err) {
    console.error("webhook secret", err);
    return;
  }
  for (const event of events) {
    const body = serializeWebhookPayload(event.payload);
    const targets = endpoints.filter((row) => storedEvents(row.events).includes(event.event));
    for (const endpoint of targets) {
      const plain = await openSecret(secretKey, endpoint.secret);
      if (!plain) {
        await insertDelivery(db, {
          organizationId,
          endpointId: endpoint.id,
          event: event.event,
          status: "failed",
          responseCode: null,
          error: "Webhook secret could not be opened",
          payloadJson: body,
        });
        continue;
      }
      const result = await postSignedWebhook({ url: endpoint.url, secret: plain, body });
      await insertDelivery(db, {
        organizationId,
        endpointId: endpoint.id,
        event: event.event,
        status: result.ok ? "delivered" : "failed",
        responseCode: result.responseCode,
        error: result.error,
        payloadJson: body,
      });
    }
  }
}

function hold(task: Promise<void>) {
  const scope = currentRequestScope();
  if (scope) scope.waitUntil(task);
}

/** Does not throw, and does not wait on the receiver. A failed POST is a delivery row. */
export function scheduleOutbound(db: AppDb, organizationId: string, events: OutboundEvent[]): void {
  if (events.length === 0) return;
  const env = currentRequestScope()?.env;
  const task = deliverOutbound(db, env, organizationId, events).catch((err) => {
    console.error("webhook delivery", err);
  });
  hold(task);
}

export function scheduleOrderCreated(
  db: AppDb,
  organizationId: string,
  input: { number: string; status: string; city?: string | null; lines: { sku: string; qty: number }[] },
): void {
  scheduleOutbound(db, organizationId, [
    {
      event: "order.created",
      payload: orderCreatedPayload({
        number: input.number,
        status: input.status,
        city: input.city,
        lines: input.lines,
      }),
    },
  ]);
}

export function scheduleOrderShipped(
  db: AppDb,
  organizationId: string,
  input: { number: string; status: string; carrier?: string | null; trackingNumber?: string | null },
): void {
  scheduleOutbound(db, organizationId, [
    {
      event: "order.shipped",
      payload: orderShippedPayload({
        number: input.number,
        status: input.status,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
      }),
    },
  ]);
}

export function scheduleStockChanged(
  db: AppDb,
  organizationId: string,
  movements: { itemId: string; qty: number; type: string }[],
  now: number,
): void {
  if (movements.length === 0) return;
  const slim = movements.map((movement) => ({ itemId: movement.itemId, qty: movement.qty, type: movement.type }));
  const env = currentRequestScope()?.env;
  const task = (async () => {
    const ids = [...new Set(slim.map((movement) => movement.itemId))];
    const rows = await db
      .select({ id: schema.items.id, sku: schema.items.sku })
      .from(schema.items)
      .where(inArray(schema.items.id, ids));
    const skus = new Map(rows.map((row) => [row.id, row.sku]));
    const changes = slim.flatMap((movement) => {
      const sku = skus.get(movement.itemId);
      return sku ? [{ sku, qty: movement.qty, type: movement.type }] : [];
    });
    if (changes.length === 0) return;
    await deliverOutbound(db, env, organizationId, [
      { event: "stock.changed", payload: stockChangedPayload({ changes, createdAt: new Date(now).toISOString() }) },
    ]);
  })().catch((err) => {
    console.error("webhook delivery", err);
  });
  hold(task);
}
