import { equipmentClassLabel } from "./equipment";
import { formatExpiresOn } from "./expiry";
import { isFloorVerb, VERB_LABELS } from "./jobs";

/** What the person sees when a request fails: one plain sentence, and the fix when there is one. */
export type ExplainedError = { message: string; hint: string | null; code: string | null };

/**
 * Every `code` the API can put on an error body (see `src/lib/error-response.ts` and the
 * `conflict(message, code)` calls in `src/routes`). Each one has its own copy below.
 */
export const ERROR_CODES = [
  "INSUFFICIENT_STOCK",
  "OVER_RECEIVE",
  "OVER_UNRECEIVE",
  "OVER_PICK",
  "OVER_PACK",
  "OVER_CARTON",
  "OVER_MOVE",
  "OVER_RETURN",
  "OVER_COMPLETE",
  "OVER_UNPICK",
  "OVER_BATCH_PICK",
  "HELD_STOCK",
  "EXPIRED_LOT",
  "INSUFFICIENT_ATP",
  "CLIENT_STOCK",
  "JOB_CLAIMED",
  "JOB_NOT_READY",
  "JOB_VERB_DENIED",
  "EQUIPMENT_IN_USE",
  "OPERATOR_CHECKED_OUT",
  "EQUIPMENT_OUT_OF_SERVICE",
  "CERT_REQUIRED",
  "CERT_EXPIRED",
  "INSPECTION_FAILED",
  "CARRIER_LIVE",
  "LIVE_ADDRESS",
  "NO_RATE",
  "NEED_PACKAGE",
  "SHIPPED",
  "CANCELLED",
  "NOT_EXCEPTION",
  "NO_LABEL",
  "NOT_RECEIVED",
  "ALREADY_PUTAWAY",
  "NOT_OPEN",
  "NOTHING_SHIPPED",
  "NO_REMAINDER",
  "MAIL_UNAVAILABLE",
  "MAIL_FAILED",
  "MAIL_ADDRESS",
  "MISSING_MEDIA",
  "MISSING_APP",
  "SHOPIFY_API",
  "MISSING_LOCATION",
  "NOT_CONNECTED",
  "NOTHING_TO_BILL",
  "SAMPLE_EXISTS",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

type Copy = { message: string; hint: string | null };
type Ctx = { body: Record<string, unknown>; text: string; status: number };

/** Turn an API error response into a plain sentence plus, when there is one, the fix. Unknown codes fall back to the server text. */
export function explainError(status: number, body: unknown, fallback: string): ExplainedError {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const text = serverText(record) ?? clean(fallback);
  const code = typeof record.code === "string" && record.code.trim() ? record.code.trim() : null;
  const ctx: Ctx = { body: record, text, status };
  const byCode = code && Object.hasOwn(COPY_BY_CODE, code) ? COPY_BY_CODE[code as ErrorCode] : undefined;
  const copy = byCode ? byCode(ctx) : byStatus(ctx);
  return { message: copy.message, hint: copy.hint, code };
}

/** The one-line form `ApiError.message` uses: the sentence, then the fix. */
export function composeErrorText(explained: { message: string; hint: string | null }): string {
  return explained.hint ? `${explained.message} ${explained.hint}` : explained.message;
}

/* ------------------------------------------------------------------ helpers */

function serverText(body: Record<string, unknown>): string | null {
  for (const key of ["error", "message"] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return clean(value);
  }
  return null;
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Capital first letter, closing full stop. Leaves the words alone. */
export function asSentence(text: string): string {
  const trimmed = clean(text);
  if (!trimmed) return trimmed;
  const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** "First sentence. The rest." → the first sentence and the rest, so a server fix reads as a hint. */
function splitSentences(text: string): Copy {
  const sentence = asSentence(text);
  const match = sentence.match(/^(.+?[.!?])\s+([A-Z].*)$/);
  if (!match) return { message: sentence, hint: null };
  return { message: match[1]!, hint: match[2]! };
}

function str(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function skuOf(body: Record<string, unknown>): string {
  return str(body, "sku") ?? "this SKU";
}

/** "3 LAMP", or just "3" when the server did not say which SKU. */
function qtyOf(n: number, body: Record<string, unknown>): string {
  const sku = str(body, "sku");
  return sku ? `${n} ${sku}` : `${n}`;
}

/** "No LAMP", or "None of this SKU" when the server did not say which SKU. */
function noneOf(body: Record<string, unknown>): string {
  const sku = str(body, "sku");
  return sku ? `No ${sku}` : "None of this SKU";
}

function isAre(n: number): string {
  return n === 1 ? "is" : "are";
}

function hasHave(n: number): string {
  return n === 1 ? "has" : "have";
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function isYyyymmdd(value: number | null): value is number {
  return value != null && Number.isInteger(value) && value >= 19000101 && value <= 29991231;
}

function formatWhen(ms: number, now = Date.now()): string {
  const at = new Date(ms);
  const sameDay = new Date(now).toDateString() === at.toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `at ${time}`;
  const day = at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `on ${day} at ${time}`;
}

/** "Only 3 LAMP are left to pick on this order." — the shape every OVER_* code shares. */
function overCopy(ctx: Ctx, leftTo: string, where: string): Copy {
  const sku = skuOf(ctx.body);
  const remaining = num(ctx.body, "remaining");
  const suffix = where ? ` ${where}` : "";
  if (remaining == null) return { message: asSentence(ctx.text), hint: "Lower the qty and try again." };
  if (remaining <= 0) {
    return { message: `Nothing is left to ${leftTo} for ${sku}${suffix}.`, hint: "Refresh to see the latest." };
  }
  return {
    message: `Only ${qtyOf(remaining, ctx.body)} ${isAre(remaining)} left to ${leftTo}${suffix}.`,
    hint: `Lower the qty to ${remaining} or less.`,
  };
}

/* ------------------------------------------------------------- by error code */

const COPY_BY_CODE: Record<ErrorCode, (ctx: Ctx) => Copy> = {
  INSUFFICIENT_STOCK: ({ body }) => {
    const sku = skuOf(body);
    const onHand = num(body, "onHand");
    const needed = num(body, "needed");
    if (onHand == null || onHand <= 0) {
      return { message: `${noneOf(body)} is on hand at this bay.`, hint: `Choose another bay, or receive ${sku} first.` };
    }
    const need = needed != null ? `, and this needs ${needed}` : "";
    return {
      message: `Only ${qtyOf(onHand, body)} ${isAre(onHand)} on hand at this bay${need}.`,
      hint: `Lower the qty to ${onHand} or less, or choose another bay.`,
    };
  },
  OVER_RECEIVE: (ctx) => overCopy(ctx, "receive", ""),
  OVER_UNRECEIVE: ({ body, text }) => {
    const received = num(body, "received");
    if (received == null) return { message: asSentence(text), hint: "Lower the qty and try again." };
    if (received <= 0) return { message: `${noneOf(body)} has been received yet.`, hint: "There is nothing to reverse." };
    return {
      message: `Only ${qtyOf(received, body)} ${hasHave(received)} been received.`,
      hint: `Lower the qty to ${received} or less.`,
    };
  },
  OVER_PICK: (ctx) => overCopy(ctx, "pick", "on this order"),
  OVER_PACK: (ctx) => overCopy(ctx, "pack", "on this order"),
  OVER_CARTON: (ctx) => overCopy(ctx, "put in a carton", ""),
  OVER_MOVE: (ctx) => overCopy(ctx, "move", ""),
  OVER_RETURN: (ctx) => overCopy(ctx, "send back", "on this vendor return"),
  OVER_COMPLETE: (ctx) => overCopy(ctx, "build", ""),
  OVER_UNPICK: ({ body, text }) => {
    const remaining = num(body, "remaining");
    if (remaining == null) return { message: asSentence(text), hint: "Lower the qty and try again." };
    if (remaining <= 0) {
      return { message: `${noneOf(body)} is picked and still unpacked on this order.`, hint: "Packed units cannot be unpicked." };
    }
    return {
      message: `Only ${qtyOf(remaining, body)} ${isAre(remaining)} picked and still unpacked on this order.`,
      hint: `Lower the qty to ${remaining} or less.`,
    };
  },
  OVER_BATCH_PICK: (ctx) => overCopy(ctx, "pick", "on this wave"),
  HELD_STOCK: ({ body }) => {
    const sku = skuOf(body);
    const bay = str(body, "locationCode");
    const reason = str(body, "reason");
    const hold = str(body, "holdNumber");
    const where = bay ? ` at ${bay}` : "";
    const why = reason ? ` (${reason})` : "";
    const release = hold && hold !== "hold" ? `Release ${hold} in Holds` : "Release the hold in Holds";
    return { message: asSentence(`${sku}${where} is on hold${why}`), hint: `${release}, or use another bay.` };
  },
  EXPIRED_LOT: ({ body }) => {
    const sku = skuOf(body);
    const lot = str(body, "lotCode");
    const expiresOn = num(body, "expiresOn");
    if (!lot) {
      return { message: asSentence(`${sku} has no unexpired lots at this bay`), hint: "Pick from another bay, or receive a fresh lot." };
    }
    const when = isYyyymmdd(expiresOn) ? ` on ${formatExpiresOn(expiresOn)}` : "";
    return {
      message: `Lot ${lot} of ${sku} expired${when}.`,
      hint: "Use a lot that has not expired, and put this one on hold.",
    };
  },
  INSUFFICIENT_ATP: ({ body }) => {
    const atp = num(body, "atp");
    const needed = num(body, "needed");
    const bay = str(body, "locationCode");
    const where = bay ? ` at ${bay}` : "";
    if (atp == null || atp <= 0) {
      return {
        message: `${noneOf(body)} is available${where}.`,
        hint: "Stock on hold or promised to other orders does not count. Receive more, or pick from another bay.",
      };
    }
    const need = needed != null ? `, and this needs ${needed}` : "";
    return {
      message: `Only ${qtyOf(atp, body)} ${isAre(atp)} available${where}${need}.`,
      hint: `The rest is on hold or promised to other orders. Lower the qty to ${atp}, or receive more.`,
    };
  },
  CLIENT_STOCK: ({ body }) => {
    const onHand = num(body, "onHand");
    const needed = num(body, "needed");
    if (onHand == null || onHand <= 0) {
      return {
        message: "This 3PL client has none of this SKU at this bay.",
        hint: "Choose another bay, or receive stock for this client first.",
      };
    }
    const need = needed != null ? `, and this needs ${needed}` : "";
    return {
      message: `This 3PL client only has ${onHand} of this SKU at this bay${need}.`,
      hint: `Lower the qty to ${onHand} or less, or receive more for this client.`,
    };
  },
  JOB_CLAIMED: ({ body }) => {
    const name = str(body, "claimedByName");
    if (!name) return { message: "Someone else is already on this job.", hint: "Pick another job, or ask them to release it." };
    return { message: `${name} is already on this job.`, hint: `Pick another job, or ask ${name} to release it.` };
  },
  JOB_NOT_READY: ({ body }) => {
    const notBefore = num(body, "notBefore");
    return {
      message: "This job is scheduled for later.",
      hint: notBefore != null ? `It opens ${formatWhen(notBefore)}. Start another job for now.` : "Start another job for now.",
    };
  },
  JOB_VERB_DENIED: ({ body, text }) => {
    const verb = str(body, "verb");
    if (!verb || !isFloorVerb(verb)) {
      return { message: asSentence(text), hint: "Ask an owner to add it to your floor verbs in Settings → Team." };
    }
    const label = VERB_LABELS[verb];
    return {
      message: `You are not set up for ${lowerFirst(label)} work.`,
      hint: `Ask an owner to add ${label} to your floor verbs in Settings → Team.`,
    };
  },
  EQUIPMENT_IN_USE: ({ text }) => ({
    message: asSentence(text),
    hint: "Check it back in first, or choose other equipment.",
  }),
  OPERATOR_CHECKED_OUT: ({ body, text }) => {
    const number = str(body, "assignmentNumber");
    return {
      message: number ? `This operator already has ${number} checked out.` : asSentence(text),
      hint: "Check that equipment back in before taking another.",
    };
  },
  EQUIPMENT_OUT_OF_SERVICE: ({ text }) => ({
    message: asSentence(text),
    hint: "Choose other equipment, or return it to service once it is fixed.",
  }),
  CERT_REQUIRED: ({ body, text }) => {
    const cls = str(body, "equipmentClass");
    return {
      message: cls ? `This operator has no ${lowerFirst(equipmentClassLabel(cls))} certification.` : asSentence(text),
      hint: "Add the certification in Equipment, or choose another operator.",
    };
  },
  CERT_EXPIRED: ({ body, text }) => {
    const cls = str(body, "equipmentClass");
    const expiresOn = num(body, "expiresOn");
    const when = isYyyymmdd(expiresOn) ? ` on ${formatExpiresOn(expiresOn)}` : "";
    return {
      message: cls
        ? `This operator's ${lowerFirst(equipmentClassLabel(cls))} certification expired${when}.`
        : asSentence(text),
      hint: "Renew it in Equipment before checking out.",
    };
  },
  INSPECTION_FAILED: ({ text }) => ({
    message: asSentence(text),
    hint: "Choose other equipment. An owner can return it to service after the repair.",
  }),
  CARRIER_LIVE: ({ text }) => ({
    message: text ? asSentence(text) : "The carrier did not accept that request.",
    hint: "Check the carrier account in Settings → Carriers, then try again.",
  }),
  LIVE_ADDRESS: () => ({
    message: "The ship-from or ship-to address is incomplete.",
    hint: "Add a street, city, region, and postal code to both, then buy the label again.",
  }),
  NO_RATE: ({ text }) => ({
    message: text ? asSentence(text) : "The carrier did not return a rate for this parcel.",
    hint: "Choose another service, or check the carton weight and size.",
  }),
  NEED_PACKAGE: ({ text }) => needPackageCopy(text),
  SHIPPED: ({ text }) => {
    if (/short-ship/i.test(text)) return splitSentences(text);
    if (/already shipped/i.test(text)) return { message: "This carton has already shipped.", hint: "Refresh to see the latest." };
    return { message: asSentence(text || "This carton has already shipped"), hint: "Shipped cartons cannot change." };
  },
  CANCELLED: ({ text }) => ({
    message: "This order is cancelled.",
    hint: text ? `${asSentence(text)}` : "Cancelled orders cannot change.",
  }),
  NOT_EXCEPTION: () => ({
    message: "Relabel is only for cartons the carrier flagged as an exception.",
    hint: "To change a normal label, void it and buy a new one.",
  }),
  NO_LABEL: () => ({
    message: "This carton has no label yet.",
    hint: "Buy a label first.",
  }),
  NOT_RECEIVED: ({ text }) => ({
    message: "This carton has not been received yet.",
    hint: /unreceiv/i.test(text) ? "There is nothing to reverse." : "Receive it onto a dock first.",
  }),
  ALREADY_PUTAWAY: ({ text }) =>
    /unreceiv/i.test(text)
      ? { message: "This carton is already put away, so it cannot be unreceived.", hint: "Move or adjust the stock instead." }
      : { message: "This carton is already put away.", hint: "Refresh to see the latest." },
  NOT_OPEN: () => ({
    message: "Short ship is only for an order that is packing or packed.",
    hint: "Pick and pack the order first.",
  }),
  NOTHING_SHIPPED: () => ({
    message: "No carton has shipped yet.",
    hint: "Ship a labeled carton first, or cancel the order if nothing has left.",
  }),
  NO_REMAINDER: () => ({
    message: "Every unit on this order is already in a shipped carton.",
    hint: "There is nothing left to short-ship.",
  }),
  MAIL_UNAVAILABLE: () => ({
    message: "Email is not set up, so Rackline cannot send an invite.",
    hint: "Give them a starter password instead, or set MAIL_API_KEY and MAIL_FROM.",
  }),
  MAIL_FAILED: () => ({
    message: "The email to the vendor did not send.",
    hint: "Check the address and try again.",
  }),
  MAIL_ADDRESS: () => ({
    message: "There is no vendor email address to send to.",
    hint: "Type the vendor's email address, then send again.",
  }),
  MISSING_MEDIA: () => ({
    message: "Photo storage is not set up.",
    hint: "Paste an image URL instead, or add the MEDIA bucket to the Worker.",
  }),
  MISSING_APP: () => ({
    message: "The Shopify app is not set up.",
    hint: "Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET, or connect with an Admin API token.",
  }),
  SHOPIFY_API: ({ text }) => ({
    message: text ? asSentence(text) : "Shopify did not accept that request.",
    hint: "Check the store in Settings → Shopify, then try again.",
  }),
  MISSING_LOCATION: () => ({
    message: "No Shopify location is chosen.",
    hint: "Pick one in Settings → Shopify, then push again.",
  }),
  NOT_CONNECTED: () => ({
    message: "Shopify is not connected.",
    hint: "Connect your store in Settings → Shopify.",
  }),
  NOTHING_TO_BILL: () => ({
    message: "There is no 3PL client activity to bill for this period.",
    hint: "Pick another period, or check that the work has a client on it.",
  }),
  SAMPLE_EXISTS: () => ({
    message: "This workspace already has SKUs or bays.",
    hint: "Sample data only loads into an empty workspace.",
  }),
};

function needPackageCopy(text: string): Copy {
  const t = text.toLowerCase();
  if (t.includes("pack remaining")) {
    return { message: "Some packed units are not in a carton yet.", hint: "Put the rest in a carton, then ship." };
  }
  if (t.includes("every carton")) {
    return { message: "A carton on this order has no label yet.", hint: "Buy a label for every carton, then ship." };
  }
  if (t.includes("this carton")) {
    return { message: "This carton has no label yet.", hint: "Buy a label for it, then ship." };
  }
  if (t.includes("each carton")) {
    return { message: "This order ships in more than one carton.", hint: "Buy a label on each carton instead." };
  }
  if (t.includes("receive each vendor carton")) {
    return { message: "This ASN has vendor cartons.", hint: "Receive it one carton at a time." };
  }
  if (t.includes("put away each vendor carton")) {
    return { message: "Vendor cartons are waiting on this dock.", hint: "Put away each carton by its BOX number or SSCC." };
  }
  if (t.includes("before printing")) {
    return { message: "This carton has no label yet.", hint: "Buy a label, then print." };
  }
  return { message: asSentence(text || "This needs a carton first"), hint: "Finish the carton step, then try again." };
}

/* ------------------------------------------------------ no code: by status */

const FIELD_LABELS: Record<string, string> = {
  qty: "Qty",
  altQty: "Alt qty",
  qtyDelta: "Qty change",
  countedQty: "Counted qty",
  warehouseId: "Warehouse",
  itemId: "SKU",
  sku: "SKU",
  locationId: "Bay",
  toLocationId: "To bay",
  fromLocationId: "From bay",
  sourceLocationId: "Source bay",
  outputLocationId: "Output bay",
  dockLocationId: "Dock",
  toBarcode: "To barcode",
  fromBarcode: "From barcode",
  vendorName: "Vendor",
  customerName: "Customer",
  carrierName: "Carrier name",
  userId: "Teammate",
  operatorUserId: "Operator",
  orderId: "Order",
  purchaseId: "Purchase",
  refType: "Document type",
  refId: "Document",
  reorderPoint: "Reorder point",
  pickMin: "Pick min",
  stockUom: "Stock unit",
  altPerStock: "Alt per stock",
  shopDomain: "Shop domain",
  organizationName: "Workspace name",
  payloadFormat: "Payload format",
  webhookSecret: "Webhook secret",
  clockId: "Clock",
  q: "Search",
};

function fieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const words = field
    .replace(/Id$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : field;
}

/**
 * Crash output from the runtime or the database driver. Case-sensitive and anchored on the exact
 * shapes those errors take, so it cannot fire on an ordinary sentence that quotes a SKU, bay,
 * serial or free-text reason ("BANANA-01", "100-RED", "held at dock (damaged)"). Safe for any status.
 */
const CRASH_TEXT = new RegExp(
  [
    String.raw`\bD1_(?:[A-Z]+_)*(?:ERROR|NOTFOUND)\b`, // D1_ERROR, D1_EXEC_ERROR, D1_COLUMN_NOTFOUND
    String.raw`\bSQLITE_[A-Z]+\b`, // SQLITE_ERROR, SQLITE_CONSTRAINT
    String.raw`\b(?:UNIQUE|NOT NULL|FOREIGN KEY|CHECK) constraint failed\b`,
    String.raw`\bno such (?:table|column): `,
    String.raw`\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b`,
    String.raw`\bCannot read propert(?:y|ies)\b`,
    String.raw`\bis not a function\b`,
    String.raw`\bat \S+ \(\S+:\d+:\d+\)`, // a stack frame: at fn (file.js:12:34)
  ].join("|"),
);

/**
 * Looser signs of a leak (a bare JS value, "internal error", a Cloudflare "error code: 1101").
 * Only 5xx bodies are tested against these: 4xx text is written for people by the route code and
 * may quote a code or reason that happens to contain one of these words.
 */
const SERVER_NOISE_VALUES = /\b(?:undefined|null|NaN)\b/;
const SERVER_NOISE_WORDS = /\binternal (?:server )?error\b|\bfetch failed\b|\berror code\b/i;

/** Server text that reads like a crash, not a sentence meant for people. */
function looksTechnical(text: string, status: number): boolean {
  if (CRASH_TEXT.test(text)) return true;
  return status >= 500 && (SERVER_NOISE_VALUES.test(text) || SERVER_NOISE_WORDS.test(text));
}

/**
 * Bare HTTP reason phrases ("Bad Request", "Not Found", "503 Service Unavailable") say nothing
 * a person can act on.
 */
const REASON_PHRASE =
  /^(?:[1-5]\d{2}\s+)?(bad request|unauthorized|forbidden|not found|conflict|payload too large|too many requests|internal server error|bad gateway|service unavailable|gateway timeout|request failed)$/i;

function byStatus(ctx: Ctx): Copy {
  const { status } = ctx;
  const text = REASON_PHRASE.test(ctx.text) ? "" : ctx.text;

  if (status === 0) {
    return { message: "Could not reach Rackline.", hint: "Check your connection and try again." };
  }
  if (status === 401) {
    return { message: "You are signed out.", hint: "Sign in again to keep working." };
  }
  if (status === 403) {
    if (!text || /^owner role required$/i.test(text)) {
      return { message: "Only the owner can do that.", hint: "Ask an owner on your team." };
    }
    if (/no organization/i.test(text)) {
      return { message: "This login is not on a team yet.", hint: "Ask an owner to invite you." };
    }
    if (/not your media/i.test(text)) {
      return { message: "That file belongs to another workspace.", hint: null };
    }
    return splitSentences(text);
  }
  if (status === 404) {
    if (!text) {
      return { message: "That was not found.", hint: "It may have been deleted. Refresh and try again." };
    }
    if (/matches that barcode$/i.test(text)) {
      return { message: asSentence(text), hint: "Check the label and scan again, or type the code." };
    }
    if (/^sku not found$/i.test(text)) {
      return { message: "No SKU matches that.", hint: "Check the SKU and try again." };
    }
    if (/not found$/i.test(text)) {
      return { message: asSentence(text), hint: "It may have been deleted. Refresh and try again." };
    }
    return splitSentences(text);
  }
  if (status === 413) {
    return { message: "That file is too large.", hint: "Use a smaller file and try again." };
  }
  if (status === 429) {
    return { message: "Too many tries in a row.", hint: "Wait a minute, then try again." };
  }
  if (/\bUNIQUE constraint failed\b/.test(text)) {
    return { message: "That already exists.", hint: "Use a different code, SKU, or barcode." };
  }
  if (status >= 500) {
    if (!text || looksTechnical(text, status)) {
      return { message: "Something went wrong on our side.", hint: "Try again in a moment." };
    }
    return splitSentences(text);
  }

  // 400 / 409 and anything else: the server text is usually already a plain sentence.
  const required = text.match(/^([a-zA-Z]+) is required$/);
  if (required) return { message: `${fieldLabel(required[1]!)} is required.`, hint: null };
  const integer = text.match(/^([a-zA-Z]+) must be an integer$/);
  if (integer) return { message: `${fieldLabel(integer[1]!)} must be a whole number.`, hint: null };
  if (/^invalid json$/i.test(text)) {
    return { message: "Rackline could not read that request.", hint: "Refresh the page and try again." };
  }
  if (/^a bom already exists for this item$/i.test(text)) {
    return { message: "A recipe already exists for this SKU.", hint: "Open it from Recipes to change it." };
  }
  if (/already exists/i.test(text)) {
    return {
      message: asSentence(text),
      hint: /\bsku\b/i.test(text) ? "Use a different SKU or barcode." : "Use a different code or barcode.",
    };
  }
  if (/quantity must be (positive|a positive integer)/i.test(text)) {
    return { message: asSentence(text), hint: "Enter 1 or more." };
  }
  if (status === 409 && /(is not (a draft|open)|already (posted|received|completed|closed|released|shipped))$/i.test(text)) {
    return { message: asSentence(text), hint: "Refresh to see the latest." };
  }
  if (!text) {
    return status === 409
      ? { message: "That changed while you were working.", hint: "Refresh and try again." }
      : { message: "That request did not go through.", hint: "Check what you entered and try again." };
  }
  if (looksTechnical(text, status)) {
    // Crash text on a 4xx says nothing about what changed, so do not claim a conflict.
    return {
      message: "That request did not go through.",
      hint: status === 409 ? "Refresh and try again." : "Check what you entered and try again.",
    };
  }
  return splitSentences(text);
}
