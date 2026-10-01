import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { postSignedWebhook } from "../db/outbound-webhooks";
import * as schema from "../db/schema";
import { parseApiScopes, storedScopes } from "../domain/public-api";
import {
  apiKeyPrefix,
  newApiSecret,
  newWebhookSecret,
  parseWebhookEvents,
  parseWebhookUrl,
  storedEvents,
  type WebhookEventName,
} from "../domain/webhooks";
import { badRequest, notFound, requireString } from "../lib/http";
import { newId } from "../lib/ids";
import { requireOwner } from "../lib/org";
import { channelSecret, openSecret, sealSecret, secretFingerprint } from "../lib/secret-box";
import type { AppEnv } from "../lib/types";

export const integrationsRoute = new Hono<AppEnv>();

function presentKey(row: typeof schema.apiKeys.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: storedScopes(row.scopes),
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

function presentEndpoint(row: typeof schema.webhookEndpoints.$inferSelect) {
  return {
    id: row.id,
    url: row.url,
    events: storedEvents(row.events),
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

integrationsRoute.get("/integrations/keys", async (c) => {
  requireOwner(c.get("role"));
  const rows = await c
    .get("db")
    .select()
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.apiKeys.createdAt));
  return c.json(rows.map(presentKey));
});

integrationsRoute.post("/integrations/keys", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ name?: string; scopes?: unknown }>();
  const name = requireString(body.name, "name");
  let scopes: ReturnType<typeof parseApiScopes>;
  try {
    scopes = parseApiScopes(body.scopes);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid scopes");
  }
  const secret = newApiSecret();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      id: newId(),
      organizationId,
      name,
      secretHash: await secretFingerprint(secret),
      prefix: apiKeyPrefix(secret),
      scopes: JSON.stringify(scopes),
      createdAt: Date.now(),
    })
    .returning();
  return c.json({ ...presentKey(row!), secret }, 201);
});

integrationsRoute.post("/integrations/keys/:id/revoke", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [key] = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, c.req.param("id")), eq(schema.apiKeys.organizationId, organizationId)))
    .limit(1);
  if (!key) notFound("API key not found");
  if (key.revokedAt == null) {
    await db.update(schema.apiKeys).set({ revokedAt: Date.now() }).where(eq(schema.apiKeys.id, key.id));
  }
  const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id)).limit(1);
  return c.json(presentKey(row!));
});

integrationsRoute.get("/integrations/webhooks/deliveries", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.webhookDeliveries.id,
      event: schema.webhookDeliveries.event,
      status: schema.webhookDeliveries.status,
      responseCode: schema.webhookDeliveries.responseCode,
      error: schema.webhookDeliveries.error,
      createdAt: schema.webhookDeliveries.createdAt,
      url: schema.webhookEndpoints.url,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
    .where(eq(schema.webhookDeliveries.organizationId, organizationId))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(50);
  return c.json(rows);
});

integrationsRoute.post("/integrations/webhooks/deliveries/:id/send", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [delivery] = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.id, c.req.param("id")), eq(schema.webhookDeliveries.organizationId, organizationId)))
    .limit(1);
  if (!delivery) notFound("Delivery not found");
  const [endpoint] = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.id, delivery.endpointId), eq(schema.webhookEndpoints.organizationId, organizationId)))
    .limit(1);
  if (!endpoint) notFound("Webhook endpoint not found");
  const plain = await openSecret(channelSecret(c.env, c.get("origin")), endpoint.secret);
  if (!plain || !endpoint.enabled) {
    const error = !plain ? "Webhook secret could not be opened" : "Webhook is turned off";
    await db.insert(schema.webhookDeliveries).values({
      id: newId(),
      organizationId,
      endpointId: endpoint.id,
      event: delivery.event,
      status: "failed",
      responseCode: null,
      error,
      payloadJson: delivery.payloadJson,
      createdAt: Date.now(),
    });
    return c.json({ status: "failed", error });
  }
  const result = await postSignedWebhook({ url: endpoint.url, secret: plain, body: delivery.payloadJson });
  await db.insert(schema.webhookDeliveries).values({
    id: newId(),
    organizationId,
    endpointId: endpoint.id,
    event: delivery.event,
    status: result.ok ? "delivered" : "failed",
    responseCode: result.responseCode,
    error: result.error,
    payloadJson: delivery.payloadJson,
    createdAt: Date.now(),
  });
  if (!result.ok) return c.json({ status: "failed", error: result.error ?? "Delivery failed" });
  return c.json({ status: "delivered" });
});

integrationsRoute.get("/integrations/webhooks", async (c) => {
  requireOwner(c.get("role"));
  const rows = await c
    .get("db")
    .select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.webhookEndpoints.createdAt));
  return c.json(rows.map(presentEndpoint));
});

integrationsRoute.post("/integrations/webhooks", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ url?: string; events?: unknown }>();
  let url: string;
  let events: WebhookEventName[];
  try {
    url = parseWebhookUrl(requireString(body.url, "url"));
    events = parseWebhookEvents(body.events);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid webhook");
  }
  const secret = newWebhookSecret();
  const sealed = await sealSecret(channelSecret(c.env, c.get("origin")), secret);
  if (!sealed) badRequest("Could not store the webhook secret");
  const [row] = await c
    .get("db")
    .insert(schema.webhookEndpoints)
    .values({
      id: newId(),
      organizationId: c.get("organizationId")!,
      url,
      events: JSON.stringify(events),
      secret: sealed,
      enabled: true,
      createdAt: Date.now(),
    })
    .returning();
  return c.json({ ...presentEndpoint(row!), secret }, 201);
});

integrationsRoute.delete("/integrations/webhooks/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [endpoint] = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.id, c.req.param("id")), eq(schema.webhookEndpoints.organizationId, organizationId)))
    .limit(1);
  if (!endpoint) notFound("Webhook endpoint not found");
  await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, endpoint.id));
  return c.body(null, 204);
});
