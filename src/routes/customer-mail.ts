import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import {
  customerMailConfigured,
  deliverCustomerEmail,
  listOrderCustomerEmails,
  loadCustomerMailSettings,
  settingsFromOrg,
  transmitCustomerMail,
} from "../db/customer-mail";
import * as schema from "../db/schema";
import {
  CUSTOMER_MAIL_EVENT_LABELS,
  isCustomerMailEvent,
  parseNotifyPolicy,
  parseReplyTo,
  parseSenderName,
  renderCustomerMail,
  sampleCustomerMail,
  type CustomerMailEvent,
  type CustomerMailSettings,
} from "../domain/customer-mail";
import { publicLink, returnLabelPagePath, trackingPagePath } from "../domain/public-token";
import { badRequest, conflict, notFound } from "../lib/http";
import { requireOwner } from "../lib/org";
import type { AppEnv } from "../lib/types";

export const customerMailRoute = new Hono<AppEnv>();

function viewSettings(settings: CustomerMailSettings, mailConfigured: boolean) {
  return { ...settings, mailConfigured, defaultPolicy: "store" as const };
}

function emailView(row: {
  id: string;
  orderId: string | null;
  rmaId: string | null;
  event: string;
  recipient: string | null;
  status: string;
  reason: string | null;
  providerId: string | null;
  subject: string | null;
  textBody: string | null;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
}) {
  return {
    ...row,
    eventLabel: isCustomerMailEvent(row.event) ? CUSTOMER_MAIL_EVENT_LABELS[row.event] : row.event,
    logged: row.providerId === "console",
  };
}

customerMailRoute.get("/organization/notifications", async (c) => {
  requireOwner(c.get("role"));
  const settings = await loadCustomerMailSettings(c.get("db"), c.get("organizationId")!);
  if (!settings) notFound("Organization not found");
  return c.json(viewSettings(settings, customerMailConfigured(c.env)));
});

customerMailRoute.patch("/organization/notifications", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const patch: Partial<typeof schema.organizations.$inferInsert> = {};
  try {
    if ("shipped" in body) patch.notifyShipped = parseNotifyPolicy(body.shipped);
    if ("outForDelivery" in body) patch.notifyOutForDelivery = parseNotifyPolicy(body.outForDelivery);
    if ("delivered" in body) patch.notifyDelivered = parseNotifyPolicy(body.delivered);
    if ("deliveryException" in body) patch.notifyDeliveryException = parseNotifyPolicy(body.deliveryException);
    if ("returnLabel" in body) patch.notifyReturnLabel = parseNotifyPolicy(body.returnLabel);
    if ("replyTo" in body) patch.mailReplyTo = parseReplyTo(body.replyTo);
    if ("senderName" in body) patch.mailSenderName = parseSenderName(body.senderName);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid notification settings");
  }
  if (Object.keys(patch).length === 0) badRequest("No notification settings to update");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await db.update(schema.organizations).set(patch).where(eq(schema.organizations.id, organizationId));
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
  if (!org) notFound("Organization not found");
  return c.json(viewSettings(settingsFromOrg(org), customerMailConfigured(c.env)));
});

async function orgBrand(c: Context<AppEnv>) {
  const [org] = await c
    .get("db")
    .select({ name: schema.organizations.name, brandColor: schema.organizations.brandColor, logoUrl: schema.organizations.logoUrl })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, c.get("organizationId")!))
    .limit(1);
  if (!org) notFound("Organization not found");
  return org;
}

function previewModel(c: Context<AppEnv>, event: CustomerMailEvent, org: { name: string; brandColor: string | null; logoUrl: string | null }) {
  const path = event === "return_label" ? returnLabelPagePath("preview") : trackingPagePath("preview");
  return sampleCustomerMail({
    event,
    shopName: org.name,
    brandColor: org.brandColor,
    logoUrl: org.logoUrl,
    trackingUrl: publicLink(c.get("origin"), path),
  });
}

customerMailRoute.post("/organization/notifications/preview", async (c) => {
  requireOwner(c.get("role"));
  const event = await eventFrom(c);
  const org = await orgBrand(c);
  return c.json(renderCustomerMail(previewModel(c, event, org)));
});

customerMailRoute.post("/organization/notifications/test", async (c) => {
  requireOwner(c.get("role"));
  const event = await eventFrom(c);
  const to = c.get("user")?.email?.trim() ?? "";
  if (!to) badRequest("Your account has no email address");
  const org = await orgBrand(c);
  const settings = await loadCustomerMailSettings(c.get("db"), c.get("organizationId")!);
  if (!settings) notFound("Organization not found");
  const rendered = renderCustomerMail(previewModel(c, event, org));
  try {
    const sent = await transmitCustomerMail(c.env, settings, to, rendered);
    return c.json({ status: "sent", providerId: sent.providerId, logged: sent.providerId === "console", to });
  } catch (err) {
    return c.json({ status: "failed", error: err instanceof Error ? err.message : "Mail failed", logged: false, to }, 409);
  }
});

async function eventFrom(c: Context<AppEnv>): Promise<CustomerMailEvent> {
  const body = await c.req.json<{ event?: unknown }>().catch(() => ({}) as { event?: unknown });
  if (typeof body.event === "string" && isCustomerMailEvent(body.event)) return body.event;
  badRequest("Choose an email");
}

customerMailRoute.get("/orders/:id/customer-emails", async (c) => {
  const orderId = c.req.param("id");
  await requireOrder(c, orderId);
  const rows = await listOrderCustomerEmails(c.get("db"), c.get("organizationId")!, orderId);
  return c.json({ emails: rows.map(emailView) });
});

customerMailRoute.post("/orders/:id/customer-emails/:event/resend", async (c) => {
  requireOwner(c.get("role"));
  const event = c.req.param("event");
  if (!isCustomerMailEvent(event) || event === "return_label") badRequest("That email cannot be resent from the order");
  const orderId = c.req.param("id");
  await requireOrder(c, orderId);
  return c.json(await resend(c, { orderId, event }));
});

customerMailRoute.post("/returns/:id/customer-emails/return-label", async (c) => {
  requireOwner(c.get("role"));
  return c.json(await resendReturn(c, c.req.param("id")));
});

/** Static enough for the inbox: the event is in the path, registered beside the button's route. */
customerMailRoute.post("/returns/:id/customer-emails/:event/resend", async (c) => {
  requireOwner(c.get("role"));
  if (c.req.param("event") !== "return_label") badRequest("That email cannot be resent from the return");
  return c.json(await resendReturn(c, c.req.param("id")));
});

async function requireOrder(c: Context<AppEnv>, orderId: string) {
  const [order] = await c
    .get("db")
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, c.get("organizationId")!)))
    .limit(1);
  if (!order) notFound("Order not found");
}

async function resendReturn(c: Context<AppEnv>, rmaId: string) {
  const [rma] = await c
    .get("db")
    .select({ id: schema.rmas.id })
    .from(schema.rmas)
    .where(and(eq(schema.rmas.id, rmaId), eq(schema.rmas.organizationId, c.get("organizationId")!)))
    .limit(1);
  if (!rma) notFound("Return not found");
  return resend(c, { rmaId, event: "return_label" });
}

async function resend(c: Context<AppEnv>, input: { orderId?: string; rmaId?: string; event: CustomerMailEvent }) {
  const row = await deliverCustomerEmail(
    { db: c.get("db"), env: c.env, origin: c.get("origin"), organizationId: c.get("organizationId")! },
    { ...input, force: true },
  );
  if (!row) notFound("Nothing to email");
  if (row.status !== "sent") conflict(row.reason || "The email was not sent", row.status === "failed" ? "MAIL_FAILED" : undefined);
  return emailView(row);
}
