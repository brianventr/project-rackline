import { backorderSource } from "./backorder";
import { capacitySource } from "./capacity";
import { carrierSource } from "./carrier";
import { customerMailSource } from "./customer-mail";
import { channelSyncSource } from "./channel-sync";
import { countSource } from "./count";
import { ediSource } from "./edi";
import { holdSource } from "./hold";
import { postBackSource } from "./post-back";
import { shipRuleSource } from "./ship-rule";
import { shopifySource } from "./shopify";
import type { ExceptionSource } from "./source";
import { automationSource } from "./automation";
import { restockSource } from "./restock";
import { trackerSource } from "./tracker";
import { webhookSource } from "./webhooks";
import { serialSource } from "./serials";

/** Every source the inbox reads, in the order it lists them. A new source is a module plus a line here. */
export const EXCEPTION_SOURCES: readonly ExceptionSource[] = [
  shipRuleSource,
  channelSyncSource,
  holdSource,
  backorderSource,
  postBackSource,
  shopifySource,
  carrierSource,
  trackerSource,
  countSource,
  capacitySource,
  ediSource,
  customerMailSource,
  webhookSource,
  restockSource,
  automationSource,
  serialSource,
];

export function exceptionSource(id: string): ExceptionSource | null {
  return EXCEPTION_SOURCES.find((source) => source.id === id) ?? null;
}
