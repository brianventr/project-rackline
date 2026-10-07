/** JSON a Gorgias HTTP widget reads. Paths match the template in Setup → Integrations. */

export type GorgiasMatch = {
  order: string | null;
  customer: string | null;
  serial: string | null;
  warranty: string;
  status: string | null;
  tracking: string | null;
  replacement: string | null;
};

export type GorgiasWarrantyPayload = {
  order: string;
  customer: string;
  serial: string;
  warranty: string;
  status: string;
  tracking: string;
  replacement: string;
  matches: GorgiasMatch[];
};

export function warrantyLabel(input: {
  eligible: boolean;
  status: string;
  end: number | null;
} | null): string {
  if (!input || input.status === "none") return "No warranty";
  const until = input.end ? ` until ${new Date(input.end).toISOString().slice(0, 10)}` : "";
  if (input.eligible) return `Eligible${until}`;
  if (input.status === "expired") return `Expired${until}`;
  if (input.status === "void") return "Void";
  return input.status;
}

export function gorgiasWarrantyPayload(
  matches: readonly {
    serial: string | null;
    serialStatus: string | null;
    warranty: { eligible: boolean; status: string; end: number | null } | null;
    order: { number: string; customerName: string; status: string; trackingNumber: string | null } | null;
    replacement: { orderNumber: string | null; newSerial: string | null; claimReference: string } | null;
  }[],
): GorgiasWarrantyPayload {
  const rows: GorgiasMatch[] = matches.map((match) => ({
    order: match.order?.number ?? null,
    customer: match.order?.customerName ?? null,
    serial: match.serial,
    warranty: warrantyLabel(match.warranty),
    status: match.serialStatus ?? match.order?.status ?? null,
    tracking: match.order?.trackingNumber ?? null,
    replacement: match.replacement
      ? [match.replacement.orderNumber, match.replacement.newSerial, match.replacement.claimReference].filter(Boolean).join(" · ")
      : null,
  }));
  const first = rows[0];
  return {
    order: first?.order ?? "",
    customer: first?.customer ?? "",
    serial: first?.serial ?? "",
    warranty: first?.warranty ?? "No warranty",
    status: first?.status ?? "",
    tracking: first?.tracking ?? "",
    replacement: first?.replacement ?? "",
    matches: rows,
  };
}

export const GORGIAS_WIDGET_TEMPLATE = {
  type: "wrapper",
  widgets: [
    {
      path: "",
      type: "card",
      title: "Rackline warranty",
      widgets: [
        { path: "order", title: "Order", type: "text" },
        { path: "customer", title: "Customer", type: "text" },
        { path: "serial", title: "Serial", type: "text" },
        { path: "warranty", title: "Warranty", type: "text" },
        { path: "status", title: "Status", type: "text" },
        { path: "tracking", title: "Tracking", type: "text" },
        { path: "replacement", title: "Replacement", type: "text" },
      ],
    },
  ],
} as const;
