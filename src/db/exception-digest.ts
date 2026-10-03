import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import type { Bindings } from "../lib/types";
import { mailConfigured } from "../domain/auth-mail";
import { exceptionDigest } from "../domain/exception-digest";
import { localYmd } from "../domain/promise";
import { isGarageMode } from "../domain/operating-mode";
import { loadExceptionItems } from "./exceptions/inbox";
import { sendMail } from "../lib/mail";

/**
 * One note a day, to owners, when something blocking is open.
 * Nothing blocking does not stamp the day, so the first problem still sends.
 */
export async function runExceptionDigests(db: AppDb, env: Bindings): Promise<void> {
  if (!mailConfigured(env)) return;
  const orgs = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      mode: schema.organizations.operatingMode,
      sentOn: schema.organizations.exceptionDigestYmd,
    })
    .from(schema.organizations);
  const from = env.MAIL_FROM!.trim();
  const appUrl = env.BETTER_AUTH_URL?.trim() || null;

  for (const org of orgs) {
    const [warehouse] = await db
      .select({ id: schema.warehouses.id, timeZone: schema.warehouses.timeZone })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.organizationId, org.id))
      .limit(1);
    if (!warehouse) continue;
    const ymd = localYmd(Date.now(), warehouse.timeZone || "UTC");
    if (org.sentOn === ymd) continue;
    const loaded = await loadExceptionItems(
      {
        db,
        organizationId: org.id,
        warehouseId: warehouse.id,
        mode: isGarageMode(org.mode) ? "garage" : "warehouse",
        now: Date.now(),
      },
      "owner",
    );
    const problems = loaded.items
      .filter((item) => item.severity === "blocking")
      .slice(0, 3)
      .map((item) => ({ title: item.title, detail: item.detail }));
    if (problems.length === 0) continue;
    const owners = await db
      .select({ email: schema.user.email })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.organizationId, org.id), eq(schema.memberships.role, "owner")));
    const mail = exceptionDigest({ orgName: org.name, problems, appUrl });
    let sent = false;
    for (const owner of owners) {
      if (!owner.email) continue;
      try {
        await sendMail({ apiKey: env.MAIL_API_KEY!.trim(), from, to: owner.email, subject: mail.subject, text: mail.text });
        sent = true;
      } catch (err) {
        console.error("exception digest failed", err);
      }
    }
    if (sent) {
      await db.update(schema.organizations).set({ exceptionDigestYmd: ymd }).where(eq(schema.organizations.id, org.id));
    }
  }
}
