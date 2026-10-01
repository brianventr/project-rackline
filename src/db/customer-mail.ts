import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { postBackRoute } from "../domain/channels/adapter";
import { resolveService } from "../domain/carriers";
import {
  asCustomerMailPolicy,
  customerMailDecision,
  customerMailFrom,
  formatEstimatedDelivery,
  policyFor,
  renderCustomerMail,
  SKIP_NO_EMAIL,
  SKIP_NO_LABEL,
  storeNotifiesCustomer,
  type CustomerMailEvent,
  type CustomerMailModel,
  type CustomerMailSettings,
  type RenderedCustomerMail,
} from "../domain/customer-mail";
import { isEmailAddress } from "../domain/purchase-mail";
import { newPublicToken, publicLink, returnLabelPagePath, trackingPagePath } from "../domain/public-token";
import { trackerHistory } from "../domain/tracking-page";
import { mailConfigured } from "../domain/auth-mail";
import { newId } from "../lib/ids";
import { sendCustomerMail } from "../lib/mail";
import type { AppEnv } from "../lib/types";
import * as schema from "./schema";
import type { AppDb } from "./stock";

type EmailRow = typeof schema.customerEmails.$inferSelect;

export type CustomerMailRuntime = {
  db: AppDb;
  env: { MAIL_API_KEY?: string; MAIL_FROM?: string };
  origin: string;
  organizationId: string;
};

const SENDING = "The email did not finish sending.";

export function settingsFromOrg(org: {
  notifyShipped: string;
  notifyOutForDelivery: string;
  notifyDelivered: string;
  notifyDeliveryException: string;
  notifyReturnLabel: string;
  mailReplyTo: string | null;
  mailSenderName: string | null;
}): CustomerMailSettings {
  return {
    shipped: asCustomerMailPolicy(org.notifyShipped),
    outForDelivery: asCustomerMailPolicy(org.notifyOutForDelivery),
    delivered: asCustomerMailPolicy(org.notifyDelivered),
    deliveryException: asCustomerMailPolicy(org.notifyDeliveryException),
    returnLabel: asCustomerMailPolicy(org.notifyReturnLabel),
    replyTo: org.mailReplyTo,
    senderName: org.mailSenderName,
  };
}

export async function loadCustomerMailSettings(db: AppDb, organizationId: string): Promise<CustomerMailSettings | null> {
  const [org] = await db
    .select({
      notifyShipped: schema.organizations.notifyShipped,
      notifyOutForDelivery: schema.organizations.notifyOutForDelivery,
      notifyDelivered: schema.organizations.notifyDelivered,
      notifyDeliveryException: schema.organizations.notifyDeliveryException,
      notifyReturnLabel: schema.organizations.notifyReturnLabel,
      mailReplyTo: schema.organizations.mailReplyTo,
      mailSenderName: schema.organizations.mailSenderName,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return org ? settingsFromOrg(org) : null;
}

function isUniqueConstraint(err: unknown): boolean {
  const message = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return message.includes("UNIQUE constraint failed");
}

async function findEmail(
  db: AppDb,
  organizationId: string,
  input: { orderId?: string | null; rmaId?: string | null; event: CustomerMailEvent },
): Promise<EmailRow | null> {
  const where =
    input.event === "return_label" && input.rmaId
      ? and(
          eq(schema.customerEmails.organizationId, organizationId),
          eq(schema.customerEmails.rmaId, input.rmaId),
          eq(schema.customerEmails.event, input.event),
        )
      : and(
          eq(schema.customerEmails.organizationId, organizationId),
          eq(schema.customerEmails.orderId, input.orderId ?? ""),
          eq(schema.customerEmails.event, input.event),
        );
  const [row] = await db.select().from(schema.customerEmails).where(where).limit(1);
  return row ?? null;
}

async function insertEmail(db: AppDb, values: typeof schema.customerEmails.$inferInsert): Promise<boolean> {
  try {
    await db.insert(schema.customerEmails).values(values);
    return true;
  } catch (err) {
    if (isUniqueConstraint(err)) return false;
    throw err;
  }
}

/**
 * Sends, or logs when mail is not configured. Never throws for a missing key: the message is
 * written to the console and the row is `sent` with provider id `console`.
 */
export async function transmitCustomerMail(
  env: { MAIL_API_KEY?: string; MAIL_FROM?: string },
  settings: CustomerMailSettings,
  to: string,
  rendered: RenderedCustomerMail,
): Promise<{ providerId: string }> {
  const apiKey = env.MAIL_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!apiKey || !from) {
    console.info(
      `[customer-mail] MAIL_API_KEY is unset; logged instead of sending\nTo: ${to}\nSubject: ${rendered.subject}\n\n${rendered.text}`,
    );
    return { providerId: "console" };
  }
  const sent = await sendCustomerMail({
    apiKey,
    from: customerMailFrom(from, settings.senderName),
    replyTo: settings.replyTo,
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
  return { providerId: sent.id };
}

type Plan =
  | { send: false; reason: string; recipient: string | null }
  | { send: true; recipient: string; rendered: RenderedCustomerMail };

async function ensureTrackingToken(db: AppDb, orderId: string, current: string | null): Promise<string> {
  if (current) return current;
  const token = newPublicToken();
  await db
    .update(schema.orders)
    .set({ trackingToken: token })
    .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.trackingToken)));
  const [row] = await db.select({ trackingToken: schema.orders.trackingToken }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  return row?.trackingToken ?? token;
}

async function shopBranding(db: AppDb, organizationId: string) {
  const [org] = await db
    .select({
      name: schema.organizations.name,
      brandColor: schema.organizations.brandColor,
      logoUrl: schema.organizations.logoUrl,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return org ?? { name: "", brandColor: null, logoUrl: null };
}

async function customerEmailFor(db: AppDb, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [row] = await db.select({ email: schema.customers.email }).from(schema.customers).where(eq(schema.customers.id, customerId)).limit(1);
  const email = row?.email?.trim() ?? "";
  return email || null;
}

async function orderStoreNotifies(db: AppDb, organizationId: string, order: { source: string; channelSyncStatus: string }): Promise<boolean> {
  if (order.source === "shopify") {
    const [shop] = await db
      .select({ mode: schema.shopifyConnections.mode })
      .from(schema.shopifyConnections)
      .where(eq(schema.shopifyConnections.organizationId, organizationId))
      .limit(1);
    return storeNotifiesCustomer({ source: "shopify", shopifyMode: shop?.mode, channelSyncStatus: order.channelSyncStatus });
  }
  if (order.source === "woocommerce" || order.source === "etsy") {
    const [conn] = await db
      .select({ status: schema.channelConnections.status, mode: schema.channelConnections.mode })
      .from(schema.channelConnections)
      .where(and(eq(schema.channelConnections.organizationId, organizationId), eq(schema.channelConnections.channel, order.source)))
      .limit(1);
    return storeNotifiesCustomer({
      source: order.source,
      postBack: postBackRoute(conn),
      channelSyncStatus: order.channelSyncStatus,
    });
  }
  return storeNotifiesCustomer({ source: order.source, channelSyncStatus: order.channelSyncStatus });
}

async function estimatedDelivery(db: AppDb, organizationId: string, trackingNumbers: string[]): Promise<string | null> {
  const numbers = trackingNumbers.filter(Boolean);
  if (numbers.length === 0) return null;
  const receipts = await db
    .select({ payloadJson: schema.trackerWebhookReceipts.payloadJson, createdAt: schema.trackerWebhookReceipts.createdAt, trackingNumber: schema.trackerWebhookReceipts.trackingNumber })
    .from(schema.trackerWebhookReceipts)
    .where(and(eq(schema.trackerWebhookReceipts.organizationId, organizationId), inArray(schema.trackerWebhookReceipts.trackingNumber, numbers)));
  for (const number of numbers) {
    const history = trackerHistory(receipts.filter((row) => row.trackingNumber === number));
    const formatted = formatEstimatedDelivery(history.estimatedDeliveryAt);
    if (formatted) return formatted;
  }
  return null;
}

async function planOrderEmail(
  runtime: CustomerMailRuntime,
  orderId: string,
  event: Exclude<CustomerMailEvent, "return_label">,
  force: boolean,
): Promise<Plan | null> {
  const { db, organizationId, origin } = runtime;
  const [order] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId))).limit(1);
  if (!order) return null;
  const settings = (await loadCustomerMailSettings(db, organizationId))!;
  const recipient = await customerEmailFor(db, order.customerId);
  if (!force) {
    const decision = customerMailDecision(policyFor(settings, event), await orderStoreNotifies(db, organizationId, order));
    if (!decision.send) return { send: false, reason: decision.reason, recipient };
  }
  if (!recipient || !isEmailAddress(recipient)) return { send: false, reason: SKIP_NO_EMAIL, recipient };
  const token = await ensureTrackingToken(db, order.id, order.trackingToken);
  const packages = await db
    .select({
      trackingNumber: schema.orderPackages.trackingNumber,
      trackingCompany: schema.orderPackages.trackingCompany,
      carrierService: schema.orderPackages.carrierService,
    })
    .from(schema.orderPackages)
    .where(eq(schema.orderPackages.orderId, order.id));
  const parcels =
    packages.length > 0
      ? packages.map((row) => parcelOf(row.trackingCompany, row.carrierService, row.trackingNumber))
      : [parcelOf(order.trackingCompany, order.carrierService, order.trackingNumber)];
  const lines = await db
    .select({ name: schema.items.name, qty: schema.orderLines.qty })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(eq(schema.orderLines.orderId, order.id));
  const shop = await shopBranding(db, organizationId);
  const trackingNumbers = parcels.map((row) => row.trackingNumber).filter((row): row is string => Boolean(row));
  const model: CustomerMailModel = {
    event,
    shopName: shop.name,
    brandColor: shop.brandColor,
    logoUrl: shop.logoUrl,
    orderNumber: order.number,
    parcels,
    trackingUrl: publicLink(origin, trackingPagePath(token)),
    items: lines.map((line) => ({ name: line.name, qty: line.qty })),
    estimatedDelivery: await estimatedDelivery(db, organizationId, trackingNumbers),
  };
  return { send: true, recipient, rendered: renderCustomerMail(model) };
}

function parcelOf(company: string | null, serviceId: string | null, trackingNumber: string | null) {
  const service = resolveService(serviceId);
  return {
    carrier: company || service?.company || null,
    service: service ? `${service.company} ${service.service}` : null,
    trackingNumber,
  };
}

async function planReturnEmail(runtime: CustomerMailRuntime, rmaId: string, force: boolean): Promise<Plan | null> {
  const { db, organizationId, origin } = runtime;
  const [rma] = await db.select().from(schema.rmas).where(and(eq(schema.rmas.id, rmaId), eq(schema.rmas.organizationId, organizationId))).limit(1);
  if (!rma) return null;
  const [label] = await db
    .select()
    .from(schema.returnLabels)
    .where(and(eq(schema.returnLabels.rmaId, rma.id), eq(schema.returnLabels.status, "active")))
    .limit(1);
  const [order] = rma.orderId
    ? await db.select().from(schema.orders).where(eq(schema.orders.id, rma.orderId)).limit(1)
    : [undefined];
  const settings = (await loadCustomerMailSettings(db, organizationId))!;
  const recipient = await customerEmailFor(db, rma.customerId ?? order?.customerId ?? null);
  if (!force) {
    const notifies = order ? await orderStoreNotifies(db, organizationId, order) : false;
    const decision = customerMailDecision(policyFor(settings, "return_label"), notifies);
    if (!decision.send) return { send: false, reason: decision.reason, recipient };
  }
  if (!label) return { send: false, reason: SKIP_NO_LABEL, recipient };
  if (!recipient || !isEmailAddress(recipient)) return { send: false, reason: SKIP_NO_EMAIL, recipient };
  const lines = await db
    .select({ name: schema.items.name, qty: schema.rmaLines.qtyExpected })
    .from(schema.rmaLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.rmaLines.itemId))
    .where(eq(schema.rmaLines.rmaId, rma.id));
  const shop = await shopBranding(db, organizationId);
  const service = resolveService(label.carrierService);
  const model: CustomerMailModel = {
    event: "return_label",
    shopName: shop.name,
    brandColor: shop.brandColor,
    logoUrl: shop.logoUrl,
    orderNumber: order?.number ?? rma.number,
    parcels: [
      {
        carrier: label.carrierCompany,
        service: service ? `${service.company} ${service.service}` : label.carrierService,
        trackingNumber: label.trackingNumber,
      },
    ],
    trackingUrl: publicLink(origin, returnLabelPagePath(label.token)),
    items: lines.map((line) => ({ name: line.name, qty: line.qty })),
    estimatedDelivery: null,
  };
  return { send: true, recipient, rendered: renderCustomerMail(model) };
}

async function writeSkipped(
  db: AppDb,
  organizationId: string,
  input: { orderId?: string | null; rmaId?: string | null; event: CustomerMailEvent },
  plan: Extract<Plan, { send: false }>,
  existing: EmailRow | null,
): Promise<EmailRow | null> {
  const now = Date.now();
  const patch = {
    recipient: plan.recipient,
    status: "skipped",
    reason: plan.reason,
    providerId: null,
    subject: null,
    textBody: null,
    updatedAt: now,
    sentAt: null,
  };
  if (existing) {
    await db.update(schema.customerEmails).set(patch).where(eq(schema.customerEmails.id, existing.id));
    return findEmail(db, organizationId, input);
  }
  const inserted = await insertEmail(db, {
    id: newId(),
    organizationId,
    orderId: input.event === "return_label" ? null : (input.orderId ?? null),
    rmaId: input.event === "return_label" ? (input.rmaId ?? null) : null,
    event: input.event,
    createdAt: now,
    ...patch,
  });
  if (!inserted) return findEmail(db, organizationId, input);
  return findEmail(db, organizationId, input);
}

/**
 * Decides, claims the one row for this order or return and event, then sends.
 * A row that already exists is left alone unless `force` (an owner resend).
 * Failures are recorded on that row. This function does not throw for a provider error.
 */
export async function deliverCustomerEmail(
  runtime: CustomerMailRuntime,
  input: { orderId?: string; rmaId?: string; event: CustomerMailEvent; force?: boolean },
): Promise<EmailRow | null> {
  const { db, organizationId } = runtime;
  const event = input.event;
  const key = { orderId: input.orderId ?? null, rmaId: input.rmaId ?? null, event };
  const existing = await findEmail(db, organizationId, key);
  if (existing && !input.force) return existing;

  const plan =
    event === "return_label"
      ? await planReturnEmail(runtime, input.rmaId ?? "", Boolean(input.force))
      : await planOrderEmail(runtime, input.orderId ?? "", event, Boolean(input.force));
  if (!plan) return null;
  if (!plan.send) {
    if (existing && !input.force) return existing;
    return writeSkipped(db, organizationId, key, plan, input.force ? existing : null);
  }

  const now = Date.now();
  const base = {
    recipient: plan.recipient,
    subject: plan.rendered.subject,
    textBody: plan.rendered.text,
    updatedAt: now,
  };
  let row = existing;
  if (!row) {
    const claimed = await insertEmail(db, {
      id: newId(),
      organizationId,
      orderId: event === "return_label" ? null : (input.orderId ?? null),
      rmaId: event === "return_label" ? (input.rmaId ?? null) : null,
      event,
      status: "failed",
      reason: SENDING,
      providerId: null,
      sentAt: null,
      createdAt: now,
      ...base,
    });
    row = await findEmail(db, organizationId, key);
    if (!claimed || !row) return row;
  }

  const settings = (await loadCustomerMailSettings(db, organizationId))!;
  try {
    const sent = await transmitCustomerMail(runtime.env, settings, plan.recipient, plan.rendered);
    await db
      .update(schema.customerEmails)
      .set({ ...base, status: "sent", reason: null, providerId: sent.providerId, sentAt: Date.now(), updatedAt: Date.now() })
      .where(eq(schema.customerEmails.id, row.id));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Mail failed";
    await db
      .update(schema.customerEmails)
      .set({ ...base, status: "failed", reason, providerId: null, sentAt: null, updatedAt: Date.now() })
      .where(eq(schema.customerEmails.id, row.id));
  }
  return findEmail(db, organizationId, key);
}

export function customerMailConfigured(env: { MAIL_API_KEY?: string; MAIL_FROM?: string }): boolean {
  return mailConfigured(env);
}

/**
 * Schedules the send on `executionCtx.waitUntil` so shipping and tracker webhooks return
 * without waiting on mail. A thrown error is logged and never reaches the caller.
 */
export function scheduleCustomerEmails(
  c: Context<AppEnv>,
  input: { event: CustomerMailEvent; orderIds?: string[]; rmaId?: string; force?: boolean },
) {
  const orderIds = [...new Set((input.orderIds ?? []).filter(Boolean))];
  if (orderIds.length === 0 && !input.rmaId) return;
  const db = c.get("db");
  const env = c.env;
  const origin = c.get("origin");
  let sessionOrg: string | undefined;
  try {
    sessionOrg = c.get("organizationId");
  } catch {
    sessionOrg = undefined;
  }
  const task = (async () => {
    const orgs = new Map<string, string[]>();
    if (sessionOrg) {
      if (orderIds.length) orgs.set(sessionOrg, orderIds);
    } else if (orderIds.length) {
      const rows = await db
        .select({ id: schema.orders.id, organizationId: schema.orders.organizationId })
        .from(schema.orders)
        .where(inArray(schema.orders.id, orderIds));
      for (const row of rows) {
        orgs.set(row.organizationId, [...(orgs.get(row.organizationId) ?? []), row.id]);
      }
    }
    for (const [organizationId, ids] of orgs) {
      const runtime: CustomerMailRuntime = { db, env, origin, organizationId };
      for (const orderId of ids) {
        try {
          await deliverCustomerEmail(runtime, { orderId, event: input.event, force: input.force });
        } catch (err) {
          console.error("customer email", err);
        }
      }
    }
    if (input.rmaId && sessionOrg) {
      try {
        await deliverCustomerEmail({ db, env, origin, organizationId: sessionOrg }, { rmaId: input.rmaId, event: input.event, force: input.force });
      } catch (err) {
        console.error("customer email", err);
      }
    }
  })();
  let executionCtx: { waitUntil(promise: Promise<unknown>): void } | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }
  if (executionCtx) executionCtx.waitUntil(task);
}

export async function listOrderCustomerEmails(db: AppDb, organizationId: string, orderId: string): Promise<EmailRow[]> {
  const direct = await db
    .select()
    .from(schema.customerEmails)
    .where(and(eq(schema.customerEmails.organizationId, organizationId), eq(schema.customerEmails.orderId, orderId)));
  const returns = await db.select({ id: schema.rmas.id }).from(schema.rmas).where(and(eq(schema.rmas.organizationId, organizationId), eq(schema.rmas.orderId, orderId)));
  const linked =
    returns.length === 0
      ? []
      : await db
          .select()
          .from(schema.customerEmails)
          .where(
            and(
              eq(schema.customerEmails.organizationId, organizationId),
              inArray(
                schema.customerEmails.rmaId,
                returns.map((row) => row.id),
              ),
            ),
          );
  return [...direct, ...linked].sort((a, b) => a.createdAt - b.createdAt);
}

export async function listRmaCustomerEmails(db: AppDb, organizationId: string, rmaId: string): Promise<EmailRow[]> {
  return db
    .select()
    .from(schema.customerEmails)
    .where(and(eq(schema.customerEmails.organizationId, organizationId), eq(schema.customerEmails.rmaId, rmaId)));
}
