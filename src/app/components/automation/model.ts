import type { Edge, Node } from "@xyflow/react";
import type { AutomationPolicy, BulkGap, ReorderAlert, ReplenishMode } from "@/domain/automation";
import type { CustomerMailPolicy } from "@/domain/customer-mail";
import type { RestockPolicy } from "@/domain/restock";

export const FLOW_STEPS = [
  { id: "replenish", label: "Replenish" },
  { id: "alerts", label: "Alerts" },
  { id: "reminders", label: "Reminders" },
  { id: "review", label: "Review" },
] as const;

export type FlowStepId = (typeof FLOW_STEPS)[number]["id"];

export type AutomationDraft = {
  policy: AutomationPolicy;
  restockPolicy: RestockPolicy;
  shipped: CustomerMailPolicy;
  outForDelivery: CustomerMailPolicy;
  delivered: CustomerMailPolicy;
  deliveryException: CustomerMailPolicy;
  returnLabel: CustomerMailPolicy;
  replyTo: string;
  senderName: string;
  mailConfigured: boolean;
};

export type AutomationView = {
  policy: AutomationPolicy;
  restockPolicy: RestockPolicy;
  notifications: {
    shipped: CustomerMailPolicy;
    outForDelivery: CustomerMailPolicy;
    delivered: CustomerMailPolicy;
    deliveryException: CustomerMailPolicy;
    returnLabel: CustomerMailPolicy;
    replyTo: string | null;
    senderName: string | null;
    mailConfigured: boolean;
  };
};

export type FlowNodeData = {
  title: string;
  detail: string;
  kind: "start" | "move" | "alert" | "mail" | "clock";
  draft: boolean;
  chips: string[];
};

const TRIGGER = "#e08a3c";
const EXECUTE = "#1f9d6a";
const DIRECT = "#6366f1";

export function draftFromView(view: AutomationView): AutomationDraft {
  return {
    policy: { ...view.policy },
    restockPolicy: view.restockPolicy,
    shipped: view.notifications.shipped,
    outForDelivery: view.notifications.outForDelivery,
    delivered: view.notifications.delivered,
    deliveryException: view.notifications.deliveryException,
    returnLabel: view.notifications.returnLabel,
    replyTo: view.notifications.replyTo ?? "",
    senderName: view.notifications.senderName ?? "",
    mailConfigured: view.notifications.mailConfigured,
  };
}

export function normalizeDraft(draft: AutomationDraft): AutomationDraft {
  return {
    ...draft,
    policy: { ...draft.policy },
    replyTo: draft.replyTo.trim(),
    senderName: draft.senderName.trim().replace(/\s+/g, " "),
  };
}

export function draftsEqual(a: AutomationDraft, b: AutomationDraft): boolean {
  const left = normalizeDraft(a);
  const right = normalizeDraft(b);
  return (
    JSON.stringify(left.policy) === JSON.stringify(right.policy) &&
    left.restockPolicy === right.restockPolicy &&
    left.shipped === right.shipped &&
    left.outForDelivery === right.outForDelivery &&
    left.delivered === right.delivered &&
    left.deliveryException === right.deliveryException &&
    left.returnLabel === right.returnLabel &&
    left.replyTo.toLowerCase() === right.replyTo.toLowerCase() &&
    left.senderName === right.senderName
  );
}

function replenishLabel(mode: ReplenishMode): string {
  return mode === "auto_queue" ? "Auto-queue" : "Suggest";
}

function gapLabel(gap: BulkGap): string {
  return gap === "exception" ? "Exception" : "Silent";
}

function hoursLabel(hours: number | null): string {
  return hours == null ? "Off" : `${hours}h`;
}

function restockLabel(policy: RestockPolicy): string {
  if (policy === "off") return "Off";
  if (policy === "draft") return "Draft PO";
  return "Alert";
}

function reorderLabel(alert: ReorderAlert): string {
  return alert === "exception" ? "Today + exception" : "Today";
}

function mailLabel(policy: CustomerMailPolicy): string {
  if (policy === "always") return "Always";
  if (policy === "never") return "Never";
  return "Store";
}

function nodeChanged(id: string, saved: AutomationDraft, draft: AutomationDraft): boolean {
  const left = normalizeDraft(saved);
  const right = normalizeDraft(draft);
  switch (id) {
    case "r-bulk":
      return left.policy.replenishMode !== right.policy.replenishMode;
    case "r-gap":
      return left.policy.bulkGap !== right.policy.bulkGap;
    case "r-doc":
    case "m-remind":
      return left.policy.remindOpenAfterHours !== right.policy.remindOpenAfterHours;
    case "a-runway":
      return left.restockPolicy !== right.restockPolicy;
    case "a-reorder":
      return left.policy.reorderAlert !== right.policy.reorderAlert;
    case "m-shipped":
      return left.shipped !== right.shipped;
    case "m-ofd":
      return left.outForDelivery !== right.outForDelivery;
    case "m-delivered":
      return left.delivered !== right.delivered;
    case "m-exception":
      return left.deliveryException !== right.deliveryException;
    case "m-return":
      return left.returnLabel !== right.returnLabel;
    case "m-sender":
      return left.replyTo.toLowerCase() !== right.replyTo.toLowerCase() || left.senderName !== right.senderName;
    default:
      return false;
  }
}

function card(
  id: string,
  position: { x: number; y: number },
  data: Omit<FlowNodeData, "draft">,
  saved: AutomationDraft,
  draft: AutomationDraft,
): Node<FlowNodeData, "flow"> {
  return {
    id,
    type: "flow",
    position,
    data: { ...data, draft: nodeChanged(id, saved, draft) },
    draggable: false,
    connectable: false,
  };
}

function link(id: string, source: string, target: string, label: string, color: string): Edge {
  return {
    id,
    source,
    target,
    label,
    type: "smoothstep",
    style: { stroke: color, strokeWidth: 1.75 },
    labelStyle: { fill: color, fontWeight: 600, fontSize: 11 },
    labelBgStyle: { fill: "var(--card)", fillOpacity: 0.96 },
    labelBgPadding: [8, 4] as [number, number],
    labelBgBorderRadius: 999,
  };
}

export function flowGraph(step: FlowStepId, saved: AutomationDraft, draft: AutomationDraft): {
  nodes: Node<FlowNodeData, "flow">[];
  edges: Edge[];
} {
  if (step === "replenish") {
    return {
      nodes: [
        card("r-start", { x: 250, y: 0 }, {
          title: "Pick face below minimum",
          detail: "A pick bay is under its pick minimum.",
          kind: "start",
          chips: ["Pick min"],
        }, saved, draft),
        card("r-bulk", { x: 20, y: 190 }, {
          title: "Bulk has stock",
          detail: "Move what the pick face is short.",
          kind: "move",
          chips: [replenishLabel(draft.policy.replenishMode)],
        }, saved, draft),
        card("r-gap", { x: 470, y: 190 }, {
          title: "No bulk",
          detail: "Nothing in bulk can cover the bay.",
          kind: "alert",
          chips: [gapLabel(draft.policy.bulkGap)],
        }, saved, draft),
        card("r-doc", { x: 20, y: 400 }, {
          title: "Open replenishment",
          detail: "Nudge if the move sits unfinished.",
          kind: "clock",
          chips: [hoursLabel(draft.policy.remindOpenAfterHours)],
        }, saved, draft),
      ],
      edges: [
        link("e-bulk", "r-start", "r-bulk", "Bulk available", TRIGGER),
        link("e-gap", "r-start", "r-gap", "No bulk", DIRECT),
        link("e-doc", "r-bulk", "r-doc", "Then", EXECUTE),
      ],
    };
  }

  if (step === "alerts") {
    return {
      nodes: [
        card("a-start", { x: 250, y: 0 }, {
          title: "Stock projection",
          detail: "Runway and on-hand, checked together.",
          kind: "start",
          chips: ["Warehouse"],
        }, saved, draft),
        card("a-runway", { x: 20, y: 210 }, {
          title: "Runway due",
          detail: "Order before make and transit run out.",
          kind: "alert",
          chips: [restockLabel(draft.restockPolicy)],
        }, saved, draft),
        card("a-reorder", { x: 470, y: 210 }, {
          title: "Reorder point",
          detail: "On hand is at or under the reorder point.",
          kind: "alert",
          chips: [reorderLabel(draft.policy.reorderAlert)],
        }, saved, draft),
      ],
      edges: [
        link("e-runway", "a-start", "a-runway", "Runway due", TRIGGER),
        link("e-reorder", "a-start", "a-reorder", "Reorder point", DIRECT),
      ],
    };
  }

  if (step === "reminders") {
    const mail = (id: string, x: number, title: string, policy: CustomerMailPolicy) =>
      card(id, { x, y: 180 }, { title, detail: "Email the customer.", kind: "mail", chips: [mailLabel(policy)] }, saved, draft);
    return {
      nodes: [
        card("m-start", { x: 520, y: 0 }, {
          title: "Reminders",
          detail: "Customer mail, and a nudge for open replenishment.",
          kind: "start",
          chips: ["Mail"],
        }, saved, draft),
        mail("m-shipped", 0, "Shipped", draft.shipped),
        mail("m-ofd", 280, "Out for delivery", draft.outForDelivery),
        mail("m-delivered", 560, "Delivered", draft.delivered),
        mail("m-exception", 840, "Delivery exception", draft.deliveryException),
        mail("m-return", 1120, "Return label", draft.returnLabel),
        card("m-remind", { x: 140, y: 420 }, {
          title: "Replenishment still open",
          detail: "Same reminder as the replenish flow.",
          kind: "clock",
          chips: [hoursLabel(draft.policy.remindOpenAfterHours)],
        }, saved, draft),
        card("m-sender", { x: 980, y: 420 }, {
          title: "Sender",
          detail: draft.senderName || draft.replyTo || "Default sender",
          kind: "mail",
          chips: [draft.senderName || "Default name"],
        }, saved, draft),
      ],
      edges: [
        link("e-shipped", "m-start", "m-shipped", "Shipped", EXECUTE),
        link("e-ofd", "m-start", "m-ofd", "On the way", EXECUTE),
        link("e-delivered", "m-start", "m-delivered", "Delivered", EXECUTE),
        link("e-exception", "m-start", "m-exception", "Problem", TRIGGER),
        link("e-return", "m-start", "m-return", "Return", DIRECT),
        link("e-remind", "m-shipped", "m-remind", "Operator", TRIGGER),
        link("e-sender", "m-return", "m-sender", "From", DIRECT),
      ],
    };
  }

  return { nodes: [], edges: [] };
}

export function reviewLines(draft: AutomationDraft): { title: string; body: string }[] {
  const hours = draft.policy.remindOpenAfterHours;
  return [
    {
      title: "Replenish",
      body:
        draft.policy.replenishMode === "auto_queue"
          ? "When a pick face drops under its minimum and bulk can cover it, Rackline opens a draft replenishment."
          : "When a pick face drops under its minimum and bulk can cover it, Rackline suggests the move. Someone still queues it.",
    },
    {
      title: "No bulk",
      body:
        draft.policy.bulkGap === "exception"
          ? "A pick face with nothing in bulk shows up in Exceptions."
          : "A pick face with nothing in bulk stays off the exception list.",
    },
    {
      title: "Open replenishment",
      body: hours == null ? "Open replenishments do not raise a reminder." : `An open replenishment raises an exception after ${hours} ${hours === 1 ? "hour" : "hours"}.`,
    },
    {
      title: "Runway",
      body:
        draft.restockPolicy === "draft"
          ? "A due restock alerts Exceptions and opens a draft purchase. The draft is not sent."
          : draft.restockPolicy === "off"
            ? "Due restocks stay off Exceptions. The restock board still shows the forecast."
            : "A due restock shows in Exceptions. Nothing is drafted.",
    },
    {
      title: "Reorder point",
      body:
        draft.policy.reorderAlert === "exception"
          ? "SKUs at the reorder point stay on Today and also enter Exceptions."
          : "SKUs at the reorder point stay on Today.",
    },
    {
      title: "Customer email",
      body: `Shipped ${mailLabel(draft.shipped).toLowerCase()}, out for delivery ${mailLabel(draft.outForDelivery).toLowerCase()}, delivered ${mailLabel(draft.delivered).toLowerCase()}, delivery exception ${mailLabel(draft.deliveryException).toLowerCase()}, return label ${mailLabel(draft.returnLabel).toLowerCase()}.`,
    },
  ];
}

export function nodeReads(id: string | null): string[] {
  switch (id) {
    case "r-start":
    case "r-bulk":
    case "r-gap":
      return ["pick_min", "slot_role", "on_hand"];
    case "r-doc":
    case "m-remind":
      return ["replenishment.status", "created_at"];
    case "a-start":
    case "a-runway":
      return ["restock_policy", "burn_rate", "lead_time"];
    case "a-reorder":
      return ["reorder_point", "on_hand"];
    case "m-shipped":
    case "m-ofd":
    case "m-delivered":
    case "m-exception":
    case "m-return":
    case "m-sender":
      return ["notify_policy", "reply_to", "sender_name"];
    default:
      return ["warehouse", "organization"];
  }
}
