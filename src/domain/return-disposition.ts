import { planReceive, planScrap, type StockPlan } from "./inventory";

export const RETURN_DISPOSITIONS = ["restock", "scrap", "hold"] as const;

export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export function isReturnDisposition(value: string): value is ReturnDisposition {
  return (RETURN_DISPOSITIONS as readonly string[]).includes(value);
}

export function parseDisposition(raw: unknown): ReturnDisposition {
  if (raw === undefined || raw === null || raw === "") return "restock";
  if (typeof raw !== "string") throw new Error("Disposition must be restock, scrap, or hold");
  const value = raw.trim().toLowerCase();
  if (!isReturnDisposition(value)) throw new Error("Disposition must be restock, scrap, or hold");
  return value;
}

export function dispositionLabel(value: string): string {
  if (value === "scrap") return "Scrap";
  if (value === "hold") return "Hold";
  return "Restock";
}

export function showPutawayAfterReturn(dispositions: Iterable<string>): boolean {
  return [...dispositions].some((row) => {
    try {
      return parseDisposition(row) === "restock";
    } catch {
      return true;
    }
  });
}

export function returnPostedMessage(number: string, dispositions: string[]): string {
  const kinds = new Set(
    dispositions.map((row) => {
      try {
        return parseDisposition(row);
      } catch {
        return "restock" as const;
      }
    }),
  );
  if (kinds.size === 1 && kinds.has("scrap")) return `${number} received and scrapped.`;
  if (kinds.size === 1 && kinds.has("hold")) return `${number} received and held at the dock.`;
  if (kinds.size === 1 && kinds.has("restock")) return `${number} received back into the bay.`;
  return `${number} received.`;
}

export function returnReceiveSteps(input: {
  itemId: string;
  sku: string;
  locationId: string;
  qty: number;
  refId: string;
  disposition: ReturnDisposition;
  lotCode?: string | null;
  serials?: string[] | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
}): Array<(balances: Map<string, number>) => StockPlan> {
  const trace = {
    lotCode: input.lotCode,
    serials: input.serials,
    weightGrams: input.weightGrams,
    expiresOn: input.expiresOn,
  };
  const receive = (balances: Map<string, number>) =>
    planReceive({
      itemId: input.itemId,
      locationId: input.locationId,
      qty: input.qty,
      refId: input.refId,
      refType: "return",
      balances,
      ...trace,
    });
  if (input.disposition !== "scrap") return [receive];
  return [
    receive,
    (balances) =>
      planScrap({
        itemId: input.itemId,
        sku: input.sku,
        locationId: input.locationId,
        qty: input.qty,
        refId: input.refId,
        balances,
        ...trace,
      }),
  ];
}
