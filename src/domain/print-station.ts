import { normalizeOrderStatus } from "./status";
import type { LabelMedia } from "./labels/zpl";

export type PrintKind = "bay" | "item" | "pack-slip" | "shipping-label" | "equipment";

export type PrintJob = {
  kind: PrintKind;
  href: string;
  title: string;
  subtitle: string;
  mediaHint?: LabelMedia;
  payloadHint?: "html" | "zpl";
};

export function isPackSlipStatus(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value === "picking" || value === "picked" || value === "packing" || value === "packed" || value === "shipped";
}

export function isShippingLabelStatus(status: string): boolean {
  const value = normalizeOrderStatus(status);
  return value === "picked" || value === "packing" || value === "packed" || value === "shipped";
}

export function packSlipHref(orderId: string): string {
  return `/outbound/orders/${orderId}/pack-slip`;
}

export function shippingLabelHref(orderId: string): string {
  return `/outbound/orders/${orderId}/shipping-label`;
}

export function packSlipJobs(
  orders: { id: string; number: string; customerName: string; status: string }[],
): PrintJob[] {
  return orders
    .filter((order) => isPackSlipStatus(order.status))
    .map((order) => ({
      kind: "pack-slip" as const,
      href: packSlipHref(order.id),
      title: order.number,
      subtitle: `${order.customerName} · ${order.status}`,
      mediaHint: "letter" as const,
      payloadHint: "html" as const,
    }));
}

export function shippingLabelJobs(
  orders: { id: string; number: string; customerName: string; status: string }[],
): PrintJob[] {
  return orders
    .filter((order) => isShippingLabelStatus(order.status))
    .map((order) => ({
      kind: "shipping-label" as const,
      href: shippingLabelHref(order.id),
      title: order.number,
      subtitle: `${order.customerName} · ${order.status}`,
      mediaHint: "4x6" as const,
      payloadHint: "zpl" as const,
    }));
}

export type ScanPrintInput = {
  kind: string;
  location?: { id: string; code: string; name: string };
  item?: { id: string; sku: string; name: string };
  order?: { id: string; number: string; customerName: string; status: string };
  equipment?: { id: string; code: string; name: string };
};

export function jobsForScan(hit: ScanPrintInput): PrintJob[] {
  if (hit.kind === "location" && hit.location) {
    return [
      {
        kind: "bay",
        href: `/stock/locations/${hit.location.id}`,
        title: hit.location.code,
        subtitle: hit.location.name,
        mediaHint: "2x1",
        payloadHint: "zpl",
      },
    ];
  }
  if (hit.kind === "item" && hit.item) {
    return [
      {
        kind: "item",
        href: `/stock/items/${hit.item.id}`,
        title: hit.item.sku,
        subtitle: hit.item.name,
        mediaHint: "2x1",
        payloadHint: "zpl",
      },
    ];
  }
  if (hit.kind === "order" && hit.order) {
    const jobs: PrintJob[] = [];
    if (isPackSlipStatus(hit.order.status)) {
      jobs.push({
        kind: "pack-slip",
        href: packSlipHref(hit.order.id),
        title: `${hit.order.number} pack slip`,
        subtitle: hit.order.customerName,
        mediaHint: "letter",
        payloadHint: "html",
      });
    }
    if (isShippingLabelStatus(hit.order.status)) {
      jobs.push({
        kind: "shipping-label",
        href: shippingLabelHref(hit.order.id),
        title: `${hit.order.number} shipping label`,
        subtitle: hit.order.customerName,
        mediaHint: "4x6",
        payloadHint: "zpl",
      });
    }
    return jobs;
  }
  if (hit.kind === "equipment" && hit.equipment) {
    return [
      {
        kind: "equipment",
        href: `/equipment/${hit.equipment.id}`,
        title: hit.equipment.code,
        subtitle: hit.equipment.name,
      },
    ];
  }
  return [];
}

export type PrinterConnection = "browser" | "qz" | "download";

export function resolvePrinterForKind(
  station: {
    defaultPrinterId?: string | null;
    bayPrinterId?: string | null;
    shippingPrinterId?: string | null;
  } | null,
  printers: { id: string; isDefault?: boolean }[],
  kind: PrintKind | "sheet",
): string | null {
  if (station) {
    if (kind === "bay" || kind === "item" || kind === "sheet" || kind === "equipment") {
      if (station.bayPrinterId) return station.bayPrinterId;
    }
    if (kind === "shipping-label") {
      if (station.shippingPrinterId) return station.shippingPrinterId;
    }
    if (station.defaultPrinterId) return station.defaultPrinterId;
  }
  const fallback = printers.find((row) => row.isDefault) ?? printers[0];
  return fallback?.id ?? null;
}
