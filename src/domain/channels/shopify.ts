import { mapRestOrder, type MappedInboundOrder, type ShopifyRestOrder } from "../shopify";
import type { ChannelOrder, ChannelSkip } from "./adapter";

/**
 * Shopify keeps its own ingest (fulfillment-order ids, sellable sync), but exposes the same
 * normalized order so channel-agnostic code (previews, queue rows, tests) reads one shape.
 */
export function shopifyChannelOrder(mapped: MappedInboundOrder): ChannelOrder {
  return {
    externalId: mapped.shopifyOrderId,
    externalName: mapped.shopifyOrderName,
    customerName: mapped.customerName,
    customerEmail: mapped.customerEmail ?? null,
    customerRef: mapped.customerRef ?? null,
    shipToAddress: mapped.shipToAddress,
    dest: mapped.dest,
    lines: mapped.lines.map((line) => ({
      sku: line.sku,
      title: line.title,
      qty: line.qty,
      externalLineId: line.shopifyLineItemId,
    })),
  };
}

export function mapShopifyOrder(order: ShopifyRestOrder): ChannelOrder | ChannelSkip {
  const mapped = mapRestOrder(order);
  return "skip" in mapped ? mapped : shopifyChannelOrder(mapped);
}
