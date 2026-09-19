import { normalizeOrderStatus } from "./status";

export type PrintKind = "bay" | "item" | "pack-slip" | "shipping-label";

export type PrintJob = {
  kind: PrintKind;
  href: string;
  title: string;
  subtitle: string;
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
    }));
}

export type ScanPrintInput = {
  kind: string;
  location?: { id: string; code: string; name: string };
  item?: { id: string; sku: string; name: string };
  order?: { id: string; number: string; customerName: string; status: string };
};

export function jobsForScan(hit: ScanPrintInput): PrintJob[] {
  if (hit.kind === "location" && hit.location) {
    return [
      {
        kind: "bay",
        href: `/stock/locations/${hit.location.id}`,
        title: hit.location.code,
        subtitle: hit.location.name,
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
      });
    }
    if (isShippingLabelStatus(hit.order.status)) {
      jobs.push({
        kind: "shipping-label",
        href: shippingLabelHref(hit.order.id),
        title: `${hit.order.number} shipping label`,
        subtitle: hit.order.customerName,
      });
    }
    return jobs;
  }
  return [];
}
