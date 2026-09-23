/**
 * Form schemas that mirror what the API checks, so a bad field is caught inline before the round trip.
 *
 * Rules of the house:
 * - Every rule here copies a server rule (the route is named next to each schema). Nothing is stricter
 *   than the server except where noted, so a form that passes here does not bounce with a 400.
 * - Text is validated, never rewritten: the output keeps exactly what was typed, so pages can build
 *   the same payload they always did. The server trims and upper-cases codes and SKUs itself.
 * - Number inputs hold strings (that is what an `<input>` gives back). Their schemas coerce to numbers
 *   the same way the server does (`Number(value)` must be a whole number).
 * - Line editors keep blank rows while you type. Rows without a SKU are dropped on submit, exactly as
 *   every create sheet has always done with `lines.filter((line) => line.itemId)`.
 */
import { z } from "zod";
import { HOLD_REASONS } from "./holds";
import { isEmailAddress } from "./purchase-mail";

/** Mirrors `ITEM_TYPES` in `src/lib/org.ts` (a test keeps them in step). */
export const FORM_ITEM_TYPES = ["raw", "wip", "finished", "packaging"] as const;
/** Mirrors `LOCATION_TYPES` in `src/lib/org.ts`. */
export const FORM_LOCATION_TYPES = ["receiving", "storage", "production", "shipping"] as const;
/** Mirrors `SLOT_ROLES` in `src/lib/org.ts`. */
export const FORM_SLOT_ROLES = ["pick", "bulk", "none"] as const;
export const FORM_ROLES = ["owner", "operator"] as const;

/** Server minimum for a starter password (`parseTeamInvite`). */
export const MIN_PASSWORD_LENGTH = 8;

/** What an input can hold for a number: the string it gives back, or a number set in code. */
const numberInput = z.union([z.string(), z.number()]);

function isBlank(value: string | number | null | undefined): boolean {
  return value == null || String(value).trim() === "";
}

/** A text field that must not be blank. The value is kept as typed. */
export function requiredText(message: string) {
  return z.string(message).refine((value) => value.trim().length > 0, message);
}

/** A text field that may be blank. */
export const optionalText = z.string();

/** One `<select>` that must have a choice (ids, not free text). */
export function requiredChoice(message: string) {
  return z.string(message).refine((value) => value.length > 0, message);
}

/** One of a fixed list, with a plain message instead of zod's enum text. */
export function choiceOf<const T extends readonly [string, ...string[]]>(values: T, message: string) {
  return z.enum(values, message);
}

export type WholeNumberCopy = {
  /** Shown when the field is blank and `blankAs` is not set. */
  empty?: string;
  /** Use this value when the field is blank, the way the page used to send `Number("")`. */
  blankAs?: number;
  notWhole: string;
  tooSmall: string;
};

/**
 * A whole number typed into an input. Mirrors `requireInt` (`Number(value)` must be an integer)
 * plus the route's lower bound. Input: string or number. Output: number.
 */
export function wholeNumber(min: number, copy: WholeNumberCopy) {
  return numberInput.transform((value, ctx): number => {
    if (isBlank(value)) {
      if (copy.blankAs !== undefined) return copy.blankAs;
      ctx.addIssue({ code: "custom", message: copy.empty ?? copy.notWhole, input: value });
      return z.NEVER;
    }
    const n = typeof value === "number" ? value : Number(value.trim());
    if (!Number.isInteger(n)) {
      ctx.addIssue({ code: "custom", message: copy.notWhole, input: value });
      return z.NEVER;
    }
    if (n < min) {
      ctx.addIssue({ code: "custom", message: copy.tooSmall, input: value });
      return z.NEVER;
    }
    return n;
  });
}

/** Parse a qty the way `qtySchema` does, or `null` when it would be rejected. */
export function parseQty(value: string | number | null | undefined): number | null {
  const result = qtySchema.safeParse(value ?? "");
  return result.success ? result.data : null;
}

/* ------------------------------------------------------------------------------------------------
 * Building blocks named in the contract
 * ---------------------------------------------------------------------------------------------- */

/** A line or document qty: whole number, 1 or more. Server: `requireInt(qty)` then `qty <= 0` → 400. */
export const qtySchema = wholeNumber(1, {
  empty: "Enter a qty.",
  notWhole: "Qty must be a whole number.",
  tooSmall: "Qty must be 1 or more.",
});

/** A SKU typed by hand. Server: `requireString(sku)`, then upper-cased; no other format rule. */
export const skuSchema = requiredText("Enter a SKU.");

/** Server: `isEmailAddress` in `src/domain/purchase-mail.ts` (team invite, PO email, vendor email). */
export const emailSchema = z.string("Enter an email.").superRefine((value, ctx) => {
  if (!value.trim()) {
    ctx.addIssue({ code: "custom", message: "Enter an email.", input: value });
  } else if (!isEmailAddress(value)) {
    ctx.addIssue({ code: "custom", message: "Enter a full email, like sam@example.com.", input: value });
  }
});

/** One SKU + qty row on its own (every row must have a SKU). */
export const lineSchema = z.object({
  itemId: requiredChoice("Pick a SKU."),
  qty: qtySchema,
});

/** A row as the line editor holds it: the SKU may still be blank. */
export const lineDraftSchema = z.object({
  itemId: z.string(),
  qty: numberInput,
});

export type LineDraft = z.input<typeof lineDraftSchema>;
export type LineValue = z.output<typeof lineSchema>;

/** The row a line editor starts with and adds. */
export function blankLine(): { itemId: string; qty: string } {
  return { itemId: "", qty: "1" };
}

function checkLines(rows: LineDraft[], ctx: z.RefinementCtx, unique: boolean) {
  const filled = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.itemId);
  if (filled.length === 0) {
    // Every create route answers 400 "At least one … line is required" for an empty list.
    if (rows.length === 0) ctx.addIssue({ code: "custom", message: "Add a line.", path: [], input: rows });
    else ctx.addIssue({ code: "custom", message: "Pick a SKU.", path: [0, "itemId"], input: rows[0]?.itemId });
    return;
  }
  const firstLine = new Map<string, number>();
  for (const { row, index } of filled) {
    const qty = qtySchema.safeParse(row.qty);
    if (!qty.success) {
      ctx.addIssue({
        code: "custom",
        message: qty.error.issues[0]?.message ?? "Qty must be 1 or more.",
        path: [index, "qty"],
        input: row.qty,
      });
    }
    if (unique) {
      const seen = firstLine.get(row.itemId);
      if (seen !== undefined) {
        // Receipts, purchases, returns, and ASNs: "Each SKU can appear once on a …".
        ctx.addIssue({
          code: "custom",
          message: `This SKU is already on line ${seen + 1}.`,
          path: [index, "itemId"],
          input: row.itemId,
        });
      } else {
        firstLine.set(row.itemId, index);
      }
    }
  }
}

function keepFilled(rows: LineDraft[]): LineValue[] {
  return rows
    .filter((row) => row.itemId)
    .map((row) => ({ itemId: row.itemId, qty: typeof row.qty === "number" ? row.qty : Number(row.qty) }));
}

/**
 * The lines of an order (same SKU may repeat). At least one row needs a SKU; rows without one are
 * dropped from the output. Output: `{ itemId, qty: number }[]`, ready for the API.
 */
export const linesSchema = z
  .array(lineDraftSchema)
  .superRefine((rows, ctx) => checkLines(rows, ctx, false))
  .transform(keepFilled);

/** Lines where each SKU can appear once (receipts, purchases, returns, ASNs). */
export const uniqueLinesSchema = z
  .array(lineDraftSchema)
  .superRefine((rows, ctx) => checkLines(rows, ctx, true))
  .transform(keepFilled);

/* ------------------------------------------------------------------------------------------------
 * Create forms. Field names match the create sheets and the API body.
 * ---------------------------------------------------------------------------------------------- */

/** Baseline ships/day: blank = auto (`null`). Server: `parseBaselineShipRate` (finite, not negative). */
const baselineShipRateSchema = numberInput.transform((value, ctx): number | null => {
  if (isBlank(value)) return null;
  const n = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "Baseline must be a number.", input: value });
    return z.NEVER;
  }
  if (n < 0) {
    ctx.addIssue({ code: "custom", message: "Baseline cannot be below 0.", input: value });
    return z.NEVER;
  }
  return n;
});

/** POST /api/items (`src/routes/catalog.ts`). Blank reorder point / pick min send 0, as the sheet does. */
export const itemFormSchema = z.object({
  sku: skuSchema,
  name: requiredText("Enter a name."),
  type: choiceOf(FORM_ITEM_TYPES, "Pick a type."),
  barcode: optionalText,
  reorderPoint: wholeNumber(0, {
    blankAs: 0,
    notWhole: "Reorder point must be a whole number.",
    tooSmall: "Reorder point cannot be below 0.",
  }),
  baselineShipRate: baselineShipRateSchema,
  pickMin: wholeNumber(0, {
    blankAs: 0,
    notWhole: "Pick min must be a whole number.",
    tooSmall: "Pick min cannot be below 0.",
  }),
  trackLot: z.boolean(),
  trackSerial: z.boolean(),
  catchWeight: z.boolean(),
  trackExpiry: z.boolean(),
});

/**
 * POST /api/locations (`src/routes/catalog.ts`). Level: the server treats blank as 1 and clamps
 * anything lower to 1; the form says so instead of silently changing it.
 */
export const locationFormSchema = z.object({
  code: requiredText("Enter a code."),
  name: requiredText("Enter a name."),
  type: choiceOf(FORM_LOCATION_TYPES, "Pick a type."),
  slotRole: choiceOf(FORM_SLOT_ROLES, "Pick a slot role."),
  aisle: optionalText,
  rack: optionalText,
  bay: optionalText,
  level: wholeNumber(1, {
    blankAs: 1,
    notWhole: "Level must be a whole number.",
    tooSmall: "Level must be 1 or more.",
  }),
});

/** POST /api/orders (`src/routes/orders.ts`). */
export const orderFormSchema = z.object({
  customerName: requiredText("Enter a customer name."),
  shipToAddress: optionalText,
  lines: linesSchema,
});

/** POST /api/receipts (`src/routes/receipts.ts`). */
export const receiptFormSchema = z.object({
  notes: optionalText,
  lines: uniqueLinesSchema,
});

/** POST /api/purchases (`src/routes/purchases.ts`). */
export const purchaseFormSchema = z.object({
  vendorName: requiredText("Enter a vendor."),
  notes: optionalText,
  lines: uniqueLinesSchema,
});

/** POST /api/team (`parseTeamInvite` in `src/domain/auth-mail.ts`). Password is optional; when set, 8+ characters. */
export const inviteFormSchema = z.object({
  name: requiredText("Enter their name."),
  email: emailSchema,
  role: choiceOf(FORM_ROLES, "Pick owner or operator."),
  password: z
    .string()
    .refine(
      (value) => !value.trim() || value.trim().length >= MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    ),
});

/** POST /api/clients (`src/routes/clients.ts`). */
export const clientFormSchema = z.object({
  code: requiredText("Enter a client code."),
  name: requiredText("Enter a client name."),
});

/** POST /api/zones (`src/routes/zones.ts`). The warehouse comes from the top bar. */
export const zoneFormSchema = z.object({
  code: requiredText("Enter a zone code."),
  name: requiredText("Enter a zone name."),
});

/* ------------------------------------------------------------------------------------------------
 * More create forms for Wave 2 (same rules, same voice).
 * ---------------------------------------------------------------------------------------------- */

/** POST /api/returns (`src/routes/returns.ts`). `orderId` is optional. */
export const returnFormSchema = z.object({
  customerName: requiredText("Enter a customer name."),
  orderId: optionalText,
  notes: optionalText,
  lines: uniqueLinesSchema,
});

/** POST /api/asns (`src/routes/asns.ts`). */
export const asnFormSchema = z.object({
  vendorName: requiredText("Enter a vendor."),
  notes: optionalText,
  lines: uniqueLinesSchema,
});

/** POST /api/holds (`src/routes/holds.ts`). A lot hold needs its SKU. */
export const holdFormSchema = z
  .object({
    locationId: requiredChoice("Pick a bay."),
    itemId: optionalText,
    lotCode: optionalText,
    reason: choiceOf(HOLD_REASONS, "Pick a reason."),
    notes: optionalText,
  })
  .superRefine((value, ctx) => {
    if (value.lotCode.trim() && !value.itemId) {
      ctx.addIssue({ code: "custom", message: "Pick the SKU this lot belongs to.", path: ["itemId"], input: value.itemId });
    }
  });

/** POST /api/work-orders (`src/routes/manufacturing.ts`) and POST /api/kits (`src/routes/kits.ts`). */
export const buildFormSchema = z.object({
  itemId: requiredChoice("Pick what to build."),
  qty: qtySchema,
  sourceLocationId: requiredChoice("Pick the bay to consume from."),
  outputLocationId: requiredChoice("Pick where finished units go."),
});
export const workOrderFormSchema = buildFormSchema;
export const kitFormSchema = buildFormSchema;

/** POST /api/yard (`src/routes/yard.ts`). */
export const yardVisitFormSchema = z.object({
  carrierName: requiredText("Enter the carrier."),
  trailerNumber: optionalText,
  notes: optionalText,
});

export type ItemFormInput = z.input<typeof itemFormSchema>;
export type LocationFormInput = z.input<typeof locationFormSchema>;
export type OrderFormInput = z.input<typeof orderFormSchema>;
export type OrderFormValues = z.output<typeof orderFormSchema>;
export type ReceiptFormInput = z.input<typeof receiptFormSchema>;
export type PurchaseFormInput = z.input<typeof purchaseFormSchema>;
export type InviteFormInput = z.input<typeof inviteFormSchema>;
export type ClientFormInput = z.input<typeof clientFormSchema>;
export type ZoneFormInput = z.input<typeof zoneFormSchema>;
