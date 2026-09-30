import { eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { setupSignals, type SetupSignals } from "../domain/onboarding";

/** The org's store and carrier signals, for `/api/onboarding` and the Ship queue's setup card alike. */
export async function loadSetupSignals(db: AppDb, organizationId: string): Promise<SetupSignals> {
  const [shopify, channels, carriers] = await Promise.all([
    db
      .select({ id: schema.shopifyConnections.id })
      .from(schema.shopifyConnections)
      .where(eq(schema.shopifyConnections.organizationId, organizationId)),
    db
      .select({ status: schema.channelConnections.status })
      .from(schema.channelConnections)
      .where(eq(schema.channelConnections.organizationId, organizationId)),
    db
      .select({ provider: schema.carrierConnections.provider })
      .from(schema.carrierConnections)
      .where(eq(schema.carrierConnections.organizationId, organizationId)),
  ]);
  return setupSignals({
    shopifyConnections: shopify.length,
    channelStatuses: channels.map((row) => row.status),
    carrierProviders: carriers.map((row) => row.provider),
  });
}
