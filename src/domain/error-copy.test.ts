import { describe, expect, it } from "vitest";
import { asSentence, composeErrorText, ERROR_CODES, explainError, type ErrorCode } from "./error-copy";

/** A realistic server body for each code, shaped like `src/lib/error-response.ts` and the route `conflict()` calls send. */
const SAMPLE: Record<ErrorCode, { status: number; body: Record<string, unknown> }> = {
  INSUFFICIENT_STOCK: { status: 409, body: { error: "Insufficient stock for LAMP: have 2, need 5", sku: "LAMP", onHand: 2, needed: 5 } },
  OVER_RECEIVE: { status: 409, body: { error: "Cannot receive 9 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 9 } },
  OVER_UNRECEIVE: { status: 409, body: { error: "Cannot unreceive 9 of LAMP: only 3 received", sku: "LAMP", received: 3, qty: 9 } },
  OVER_PICK: { status: 409, body: { error: "Cannot pick 5 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 5 } },
  OVER_PACK: { status: 409, body: { error: "Cannot pack 5 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 5 } },
  OVER_CARTON: { status: 409, body: { error: "Cannot carton 5 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 5 } },
  OVER_MOVE: { status: 409, body: { error: "Cannot move 5 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 5 } },
  OVER_RETURN: { status: 409, body: { error: "Cannot return 5 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 5 } },
  OVER_COMPLETE: { status: 409, body: { error: "Cannot complete 5 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 5 } },
  OVER_UNPICK: { status: 409, body: { error: "Cannot unpick 5 of LAMP: only 3 remaining", sku: "LAMP", remaining: 3, qty: 5 } },
  OVER_BATCH_PICK: {
    status: 409,
    body: { error: "Cannot batch-pick 5 of LAMP; only 3 remaining on the wave", sku: "LAMP", remaining: 3, qty: 5 },
  },
  HELD_STOCK: {
    status: 409,
    body: {
      error: "SHADE at B-01-01 is on hold (HLD-9: Damaged)",
      sku: "SHADE",
      locationCode: "B-01-01",
      holdNumber: "HLD-9",
      reason: "Damaged",
    },
  },
  EXPIRED_LOT: {
    status: 400,
    body: { error: "RESIN lot L-7 expired 2026-03-01", sku: "RESIN", lotCode: "L-7", expiresOn: 20260301 },
  },
  INSUFFICIENT_ATP: {
    status: 409,
    body: { error: "Not enough available LAMP at B-01-01: ATP 1, need 4", sku: "LAMP", atp: 1, needed: 4, locationCode: "B-01-01" },
  },
  CLIENT_STOCK: {
    status: 409,
    body: { error: "Client stock insufficient: have 2, need 5", clientId: "c1", itemId: "i1", onHand: 2, needed: 5 },
  },
  JOB_CLAIMED: { status: 409, body: { error: "This job is claimed by Sam", claimedById: "u2", claimedByName: "Sam" } },
  JOB_NOT_READY: { status: 409, body: { error: "This job is scheduled for later", notBefore: Date.UTC(2030, 0, 2, 15, 30) } },
  JOB_VERB_DENIED: { status: 403, body: { error: "You are not assigned the Pick verb", verb: "pick" } },
  EQUIPMENT_IN_USE: {
    status: 409,
    body: { error: "FL-02 is already checked out (EQA-3)", equipmentId: "e1", assignmentId: "a1", assignmentNumber: "EQA-3" },
  },
  OPERATOR_CHECKED_OUT: {
    status: 409,
    body: { error: "Operator already has EQA-3 open", assignmentId: "a1", assignmentNumber: "EQA-3", equipmentId: "e1" },
  },
  EQUIPMENT_OUT_OF_SERVICE: { status: 409, body: { error: "FL-02 is out of service", equipmentId: "e1" } },
  CERT_REQUIRED: { status: 409, body: { error: "Operator is not certified for Reach truck", equipmentClass: "reach" } },
  CERT_EXPIRED: { status: 409, body: { error: "Reach truck certification expired", equipmentClass: "reach", expiresOn: 20260101 } },
  INSPECTION_FAILED: { status: 409, body: { error: "FL-02 failed pre-use inspection and is out of service" } },
  CARRIER_LIVE: { status: 409, body: { error: "Live postage needs an API key", code: "CARRIER_LIVE" } },
  LIVE_ADDRESS: {
    status: 409,
    body: { error: "Live postage needs a street, city, region, and postal code on ship-from and ship-to." },
  },
  NO_RATE: { status: 409, body: { error: "EasyPost did not return a Priority rate for this parcel." } },
  NEED_PACKAGE: { status: 409, body: { error: "Buy a label for every carton before shipping" } },
  SHIPPED: { status: 409, body: { error: "Carton is already shipped" } },
  CANCELLED: { status: 409, body: { error: "Cancelled orders cannot drop a carton" } },
  NOT_EXCEPTION: { status: 409, body: { error: "Relabel is for tracker exceptions" } },
  NO_LABEL: { status: 409, body: { error: "Buy a label before relabeling" } },
  NOT_RECEIVED: { status: 409, body: { error: "Receive the carton before putaway" } },
  ALREADY_PUTAWAY: { status: 409, body: { error: "Carton is already put away" } },
  NOT_OPEN: { status: 409, body: { error: "Short ship is only for a packing or packed order" } },
  NOTHING_SHIPPED: { status: 409, body: { error: "Ship a labeled carton before short-shipping. Cancel if nothing has left." } },
  NO_REMAINDER: { status: 409, body: { error: "Every ordered unit is already in a shipped carton" } },
  MAIL_UNAVAILABLE: { status: 409, body: { error: "Set MAIL_API_KEY and MAIL_FROM to invite without a starter password" } },
  MAIL_FAILED: { status: 409, body: { error: "Resend rejected the request" } },
  MAIL_ADDRESS: { status: 409, body: { error: "Send needs a vendor email address" } },
  MISSING_MEDIA: { status: 409, body: { error: "Media bucket is not configured" } },
  MISSING_APP: { status: 409, body: { error: "Shopify app credentials are not configured" } },
  SHOPIFY_API: { status: 409, body: { error: "Shopify returned 401 for locations" } },
  MISSING_LOCATION: { status: 409, body: { error: "Set a Shopify location before pushing sellable qty." } },
  NOT_CONNECTED: { status: 400, body: { error: "Shopify is not connected" } },
  NOTHING_TO_BILL: { status: 409, body: { error: "No client activity to bill for this period" } },
  SAMPLE_EXISTS: { status: 409, body: { error: "Sample data only loads into an empty org" } },
};

function explain(code: ErrorCode, extra: Record<string, unknown> = {}) {
  const sample = SAMPLE[code];
  return explainError(sample.status, { ...sample.body, code, ...extra }, "Request failed");
}

describe("explainError — every code", () => {
  it("has a sample for every listed code", () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(ERROR_CODES)("%s reads as plain sentences with a fix", (code) => {
    const out = explain(code);
    expect(out.code).toBe(code);
    expect(out.message).toMatch(/^[A-Z0-9].*[.?]$/);
    expect(out.message).not.toMatch(/!/);
    expect(out.hint).not.toBeNull();
    expect(out.hint).toMatch(/^[A-Z].*\.$/);
    expect(out.hint).not.toMatch(/!/);
  });

  it("INSUFFICIENT_STOCK names the bay count and the fix", () => {
    expect(explain("INSUFFICIENT_STOCK")).toEqual({
      code: "INSUFFICIENT_STOCK",
      message: "Only 2 LAMP are on hand at this bay, and this needs 5.",
      hint: "Lower the qty to 2 or less, or choose another bay.",
    });
    expect(explain("INSUFFICIENT_STOCK", { onHand: 0 }).message).toBe("No LAMP is on hand at this bay.");
    expect(explain("INSUFFICIENT_STOCK", { onHand: 1 }).message).toBe("Only 1 LAMP is on hand at this bay, and this needs 5.");
  });

  it("OVER_PICK matches the brief", () => {
    expect(explain("OVER_PICK")).toEqual({
      code: "OVER_PICK",
      message: "Only 3 LAMP are left to pick on this order.",
      hint: "Lower the qty to 3 or less.",
    });
    expect(explain("OVER_PICK", { remaining: 1 }).message).toBe("Only 1 LAMP is left to pick on this order.");
    expect(explain("OVER_PICK", { remaining: 0 })).toMatchObject({
      message: "Nothing is left to pick for LAMP on this order.",
      hint: "Refresh to see the latest.",
    });
  });

  it("OVER_* codes name the step", () => {
    expect(explain("OVER_RECEIVE").message).toBe("Only 3 LAMP are left to receive.");
    expect(explain("OVER_PACK").message).toBe("Only 3 LAMP are left to pack on this order.");
    expect(explain("OVER_CARTON").message).toBe("Only 3 LAMP are left to put in a carton.");
    expect(explain("OVER_MOVE").message).toBe("Only 3 LAMP are left to move.");
    expect(explain("OVER_RETURN").message).toBe("Only 3 LAMP are left to send back on this vendor return.");
    expect(explain("OVER_COMPLETE").message).toBe("Only 3 LAMP are left to build.");
    expect(explain("OVER_BATCH_PICK").message).toBe("Only 3 LAMP are left to pick on this wave.");
    for (const code of ["OVER_RECEIVE", "OVER_PACK", "OVER_CARTON", "OVER_MOVE", "OVER_RETURN", "OVER_COMPLETE", "OVER_BATCH_PICK"] as const) {
      expect(explain(code).hint).toBe("Lower the qty to 3 or less.");
    }
  });

  it("OVER_* without numbers falls back to the server text", () => {
    const out = explainError(409, { error: "Cannot pick 5 of LAMP: only 3 remaining", code: "OVER_PICK" }, "x");
    expect(out).toEqual({ code: "OVER_PICK", message: "Cannot pick 5 of LAMP: only 3 remaining.", hint: "Lower the qty and try again." });
  });

  it("OVER_UNRECEIVE and OVER_UNPICK", () => {
    expect(explain("OVER_UNRECEIVE")).toMatchObject({
      message: "Only 3 LAMP have been received.",
      hint: "Lower the qty to 3 or less.",
    });
    expect(explain("OVER_UNRECEIVE", { received: 0 }).message).toBe("No LAMP has been received yet.");
    expect(explain("OVER_UNPICK")).toMatchObject({
      message: "Only 3 LAMP are picked and still unpacked on this order.",
      hint: "Lower the qty to 3 or less.",
    });
    expect(explain("OVER_UNPICK", { remaining: 0 }).hint).toBe("Packed units cannot be unpicked.");
  });

  it("HELD_STOCK names the hold to release", () => {
    expect(explain("HELD_STOCK")).toMatchObject({
      message: "SHADE at B-01-01 is on hold (Damaged).",
      hint: "Release HLD-9 in Holds, or use another bay.",
    });
    expect(explain("HELD_STOCK", { holdNumber: "hold" }).hint).toBe("Release the hold in Holds, or use another bay.");
  });

  it("EXPIRED_LOT with and without a lot", () => {
    expect(explain("EXPIRED_LOT")).toMatchObject({
      message: "Lot L-7 of RESIN expired on 2026-03-01.",
      hint: "Use a lot that has not expired, and put this one on hold.",
    });
    expect(explain("EXPIRED_LOT", { lotCode: null, expiresOn: null })).toMatchObject({
      message: "RESIN has no unexpired lots at this bay.",
      hint: "Pick from another bay, or receive a fresh lot.",
    });
  });

  it("INSUFFICIENT_ATP explains held and promised stock", () => {
    expect(explain("INSUFFICIENT_ATP")).toMatchObject({
      message: "Only 1 LAMP is available at B-01-01, and this needs 4.",
      hint: "The rest is on hold or promised to other orders. Lower the qty to 1, or receive more.",
    });
    expect(explain("INSUFFICIENT_ATP", { atp: 0, locationCode: undefined }).message).toBe("No LAMP is available.");
  });

  it("CLIENT_STOCK", () => {
    expect(explain("CLIENT_STOCK")).toMatchObject({
      message: "This 3PL client only has 2 of this SKU at this bay, and this needs 5.",
      hint: "Lower the qty to 2 or less, or receive more for this client.",
    });
    expect(explain("CLIENT_STOCK", { onHand: 0 }).message).toBe("This 3PL client has none of this SKU at this bay.");
  });

  it("job codes", () => {
    expect(explain("JOB_CLAIMED")).toMatchObject({
      message: "Sam is already on this job.",
      hint: "Pick another job, or ask Sam to release it.",
    });
    expect(explain("JOB_CLAIMED", { claimedByName: "" }).message).toBe("Someone else is already on this job.");
    const notReady = explain("JOB_NOT_READY");
    expect(notReady.message).toBe("This job is scheduled for later.");
    expect(notReady.hint).toMatch(/^It opens on .+\. Start another job for now\.$/);
    expect(explain("JOB_NOT_READY", { notBefore: undefined }).hint).toBe("Start another job for now.");
    expect(explain("JOB_VERB_DENIED")).toMatchObject({
      message: "You are not set up for pick work.",
      hint: "Ask an owner to add Pick to your floor verbs in Settings → Team.",
    });
    expect(explain("JOB_VERB_DENIED", { verb: "rtv" }).message).toBe("You are not set up for vendor return work.");
  });

  it("equipment codes", () => {
    expect(explain("EQUIPMENT_IN_USE")).toMatchObject({
      message: "FL-02 is already checked out (EQA-3).",
      hint: "Check it back in first, or choose other equipment.",
    });
    expect(explain("OPERATOR_CHECKED_OUT").message).toBe("This operator already has EQA-3 checked out.");
    expect(explain("EQUIPMENT_OUT_OF_SERVICE").message).toBe("FL-02 is out of service.");
    expect(explain("CERT_REQUIRED").message).toBe("This operator has no reach truck certification.");
    expect(explain("CERT_EXPIRED").message).toBe("This operator's reach truck certification expired on 2026-01-01.");
    expect(explain("INSPECTION_FAILED").message).toBe("FL-02 failed pre-use inspection and is out of service.");
  });

  it("carrier codes keep the carrier's reason", () => {
    expect(explain("CARRIER_LIVE")).toMatchObject({
      message: "Live postage needs an API key.",
      hint: "Check the carrier account in Settings → Carriers, then try again.",
    });
    expect(explain("LIVE_ADDRESS").message).toBe("The ship-from or ship-to address is incomplete.");
    expect(explain("NO_RATE")).toMatchObject({
      message: "EasyPost did not return a Priority rate for this parcel.",
      hint: "Choose another service, or check the carton weight and size.",
    });
  });

  it("NEED_PACKAGE picks the right carton step", () => {
    const need = (error: string) => explainError(409, { error, code: "NEED_PACKAGE" }, "x");
    expect(need("Pack remaining units into cartons before shipping").message).toBe("Some packed units are not in a carton yet.");
    expect(need("Buy a label for every carton before shipping").message).toBe("A carton on this order has no label yet.");
    expect(need("Buy a label for this carton before shipping").hint).toBe("Buy a label for it, then ship.");
    expect(need("Buy a label on each carton").message).toBe("This order ships in more than one carton.");
    expect(need("Receive each vendor carton").hint).toBe("Receive it one carton at a time.");
    expect(need("Put away each vendor carton").hint).toBe("Put away each carton by its BOX number or SSCC.");
    expect(need("Buy a label before printing").hint).toBe("Buy a label, then print.");
    expect(need("Something new")).toMatchObject({ message: "Something new.", hint: "Finish the carton step, then try again." });
  });

  it("carton and order state codes", () => {
    expect(explain("SHIPPED").message).toBe("This carton has already shipped.");
    expect(explainError(409, { error: "Shipped cartons stay out. Short-ship the remainder.", code: "SHIPPED" }, "x")).toMatchObject({
      message: "Shipped cartons stay out.",
      hint: "Short-ship the remainder.",
    });
    expect(explain("CANCELLED")).toMatchObject({
      message: "This order is cancelled.",
      hint: "Cancelled orders cannot drop a carton.",
    });
    expect(explain("NOT_EXCEPTION").hint).toBe("To change a normal label, void it and buy a new one.");
    expect(explain("NO_LABEL").message).toBe("This carton has no label yet.");
    expect(explain("NOT_RECEIVED").hint).toBe("Receive it onto a dock first.");
    expect(explain("NOT_RECEIVED", { error: "Receive the carton before unreceiving" }).hint).toBe("There is nothing to reverse.");
    expect(explain("ALREADY_PUTAWAY").message).toBe("This carton is already put away.");
    expect(explain("ALREADY_PUTAWAY", { error: "Put-away cartons cannot be unreceived" }).message).toBe(
      "This carton is already put away, so it cannot be unreceived.",
    );
  });

  it("short ship codes", () => {
    expect(explain("NOT_OPEN").hint).toBe("Pick and pack the order first.");
    expect(explain("NOTHING_SHIPPED")).toMatchObject({
      message: "No carton has shipped yet.",
      hint: "Ship a labeled carton first, or cancel the order if nothing has left.",
    });
    expect(explain("NO_REMAINDER").message).toBe("Every unit on this order is already in a shipped carton.");
  });

  it("mail, media, Shopify, billing, and sample codes", () => {
    expect(explain("MAIL_UNAVAILABLE")).toMatchObject({
      message: "Email is not set up, so Rackline cannot send an invite.",
      hint: "Give them a starter password instead, or set MAIL_API_KEY and MAIL_FROM.",
    });
    expect(explain("MAIL_FAILED").message).toBe("The email to the vendor did not send.");
    expect(explain("MAIL_ADDRESS").message).toBe("There is no vendor email address to send to.");
    expect(explain("MISSING_MEDIA").message).toBe("Photo storage is not set up.");
    expect(explain("MISSING_APP").message).toBe("The Shopify app is not set up.");
    expect(explain("SHOPIFY_API")).toMatchObject({
      message: "Shopify returned 401 for locations.",
      hint: "Check the store in Settings → Shopify, then try again.",
    });
    expect(explain("MISSING_LOCATION").message).toBe("No Shopify location is chosen.");
    expect(explain("NOT_CONNECTED").hint).toBe("Connect your store in Settings → Shopify.");
    expect(explain("NOTHING_TO_BILL").message).toBe("There is no 3PL client activity to bill for this period.");
    expect(explain("SAMPLE_EXISTS")).toMatchObject({
      message: "This workspace already has SKUs or bays.",
      hint: "Sample data only loads into an empty workspace.",
    });
  });

  it("reads well when the body has no sku", () => {
    expect(explainError(409, { code: "OVER_PICK", remaining: 2 }, "x").message).toBe("Only 2 are left to pick on this order.");
    expect(explainError(409, { code: "OVER_PICK", remaining: 0 }, "x").message).toBe("Nothing is left to pick for this SKU on this order.");
    expect(explainError(409, { code: "INSUFFICIENT_STOCK", onHand: 0 }, "x").message).toBe("None of this SKU is on hand at this bay.");
    expect(explainError(409, { code: "INSUFFICIENT_ATP", atp: 0 }, "x").message).toBe("None of this SKU is available.");
    expect(explainError(409, { code: "HELD_STOCK", locationCode: "B-01-01" }, "x").message).toBe("This SKU at B-01-01 is on hold.");
    expect(explainError(400, { code: "EXPIRED_LOT" }, "x").message).toBe("This SKU has no unexpired lots at this bay.");
  });
});

describe("explainError — no code", () => {
  it("unknown codes keep the server text and the code", () => {
    expect(explainError(409, { error: "Bay is full", code: "BAY_FULL" }, "x")).toEqual({
      code: "BAY_FULL",
      message: "Bay is full.",
      hint: null,
    });
    expect(explainError(409, { error: "Odd", code: "constructor" }, "x")).toEqual({ code: "constructor", message: "Odd.", hint: null });
  });

  it("keeps plain server sentences and splits a trailing fix into the hint", () => {
    expect(explainError(409, { error: "Move stock off this rack before deleting it." }, "x")).toEqual({
      code: null,
      message: "Move stock off this rack before deleting it.",
      hint: null,
    });
    expect(
      explainError(409, { error: "That email already has a Rackline login. Invite them from a fresh email for now." }, "x"),
    ).toEqual({
      code: null,
      message: "That email already has a Rackline login.",
      hint: "Invite them from a fresh email for now.",
    });
    expect(explainError(400, { error: "Line is not on this order" }, "x").message).toBe("Line is not on this order.");
  });

  it("401 means signed out", () => {
    expect(explainError(401, { error: "Unauthorized" }, "Unauthorized")).toEqual({
      code: null,
      message: "You are signed out.",
      hint: "Sign in again to keep working.",
    });
  });

  it("403 owner-only, no team, and other text", () => {
    expect(explainError(403, { error: "Owner role required" }, "x")).toMatchObject({
      message: "Only the owner can do that.",
      hint: "Ask an owner on your team.",
    });
    expect(explainError(403, {}, "Forbidden").message).toBe("Only the owner can do that.");
    expect(explainError(403, { error: "No organization for this user" }, "x").message).toBe("This login is not on a team yet.");
    expect(explainError(403, { error: "Not your media" }, "x").message).toBe("That file belongs to another workspace.");
    expect(explainError(403, { error: "Operators can only view their own performance" }, "x")).toMatchObject({
      message: "Operators can only view their own performance.",
      hint: null,
    });
  });

  it("404 generic, not found, and barcode misses", () => {
    expect(explainError(404, {}, "Not Found")).toMatchObject({
      message: "That was not found.",
      hint: "It may have been deleted. Refresh and try again.",
    });
    expect(explainError(404, { error: "SKU not found" }, "x")).toMatchObject({
      message: "No SKU matches that.",
      hint: "Check the SKU and try again.",
    });
    expect(explainError(404, { error: "Carton not found" }, "x")).toMatchObject({
      message: "Carton not found.",
      hint: "It may have been deleted. Refresh and try again.",
    });
    expect(explainError(404, { error: "No item matches that barcode" }, "x")).toMatchObject({
      message: "No item matches that barcode.",
      hint: "Check the label and scan again, or type the code.",
    });
  });

  it("400 field checks read as labels, not field names", () => {
    expect(explainError(400, { error: "warehouseId is required" }, "x").message).toBe("Warehouse is required.");
    expect(explainError(400, { error: "itemId is required" }, "x").message).toBe("SKU is required.");
    expect(explainError(400, { error: "qty must be an integer" }, "x").message).toBe("Qty must be a whole number.");
    expect(explainError(400, { error: "fooBarId is required" }, "x").message).toBe("Foo bar is required.");
    expect(explainError(400, { error: "Invalid JSON" }, "x").message).toBe("Rackline could not read that request.");
    expect(explainError(400, { error: "Line quantity must be positive" }, "x").hint).toBe("Enter 1 or more.");
    expect(explainError(400, {}, "Bad Request")).toMatchObject({
      message: "That request did not go through.",
      hint: "Check what you entered and try again.",
    });
  });

  it("409 duplicates and stale state get a fix", () => {
    expect(explainError(409, { error: "SKU or barcode already exists" }, "x").hint).toBe("Use a different SKU or barcode.");
    expect(explainError(409, { error: "A BOM already exists for this item" }, "x")).toMatchObject({
      message: "A recipe already exists for this SKU.",
      hint: "Open it from Recipes to change it.",
    });
    expect(explainError(409, { error: "Barcode already exists" }, "x").hint).toBe("Use a different code or barcode.");
    expect(explainError(409, { error: "Transfer already posted" }, "x")).toMatchObject({
      message: "Transfer already posted.",
      hint: "Refresh to see the latest.",
    });
    expect(explainError(409, { error: "Purchase is not a draft" }, "x").hint).toBe("Refresh to see the latest.");
    expect(explainError(409, {}, "Conflict")).toMatchObject({
      message: "That changed while you were working.",
      hint: "Refresh and try again.",
    });
  });

  it("network, rate limit, size, and server failures", () => {
    expect(explainError(0, null, "Failed to fetch")).toMatchObject({
      message: "Could not reach Rackline.",
      hint: "Check your connection and try again.",
    });
    expect(explainError(429, {}, "Too Many Requests").message).toBe("Too many tries in a row.");
    expect(explainError(413, {}, "Payload Too Large").message).toBe("That file is too large.");
    expect(explainError(500, { error: "D1_ERROR: no such column: foo" }, "x")).toMatchObject({
      message: "Something went wrong on our side.",
      hint: "Try again in a moment.",
    });
    expect(explainError(500, { error: "D1_ERROR: UNIQUE constraint failed: items.sku" }, "x").message).toBe("That already exists.");
    expect(explainError(500, { error: "Cannot read properties of undefined (reading 'id')" }, "x").message).toBe(
      "Something went wrong on our side.",
    );
    expect(explainError(502, {}, "Bad Gateway").message).toBe("Something went wrong on our side.");
    expect(explainError(503, {}, "503 Service Unavailable").message).toBe("Something went wrong on our side.");
    expect(explainError(500, { error: "error code: 1101" }, "x").message).toBe("Something went wrong on our side.");
    expect(explainError(500, { error: "qty was NaN" }, "x").message).toBe("Something went wrong on our side.");
    expect(explainError(500, { error: "boom at handler (worker.js:12:34)" }, "x").message).toBe(
      "Something went wrong on our side.",
    );
    expect(explainError(500, { error: "Line is not on this document" }, "x").message).toBe("Line is not on this document.");
  });

  it("keeps 4xx sentences whose SKU, bay, serial or reason only looks like crash text", () => {
    // SKUs and serials that contain "nan" (BANANA, NANO, FINANCE, MAINTENANCE, TENANT).
    expect(explainError(409, { error: "BANANA-01 is already on this count" }, "x")).toEqual({
      code: null,
      message: "BANANA-01 is already on this count.",
      hint: null,
    });
    expect(explainError(409, { error: "MAINTENANCE-KIT is already on this count" }, "x").message).toBe(
      "MAINTENANCE-KIT is already on this count.",
    );
    expect(explainError(400, { error: "SKU NANO-LEAF not in catalog" }, "x").message).toBe("SKU NANO-LEAF not in catalog.");
    expect(explainError(400, { error: "Serial SN-FINANCE is not on hand" }, "x").message).toBe(
      "Serial SN-FINANCE is not on hand.",
    );
    expect(explainError(400, { error: "TENANT-9 requires a lot code" }, "x").message).toBe("TENANT-9 requires a lot code.");
    // SKUs and bays that start with a number.
    expect(explainError(400, { error: "100-RED requires a lot code" }, "x")).toEqual({
      code: null,
      message: "100-RED requires a lot code.",
      hint: null,
    });
    expect(explainError(409, { error: "101 is already on this count" }, "x").message).toBe("101 is already on this count.");
    // Free-text hold reasons with "at … (".
    expect(explainError(409, { error: "Held at dock (damaged) by Sam" }, "x").message).toBe("Held at dock (damaged) by Sam.");
    // The same kinds of text on a 5xx are plain sentences too.
    expect(explainError(500, { error: "BANANA-01 could not be moved" }, "x").message).toBe("BANANA-01 could not be moved.");
    expect(explainError(500, { error: "100-RED could not be moved" }, "x").message).toBe("100-RED could not be moved.");
  });

  it("hides real crash text on a 4xx without claiming a conflict", () => {
    expect(explainError(400, { error: "D1_ERROR: no such column: foo" }, "x")).toMatchObject({
      message: "That request did not go through.",
      hint: "Check what you entered and try again.",
    });
    expect(explainError(409, { error: "TypeError: x is not a function" }, "x")).toMatchObject({
      message: "That request did not go through.",
      hint: "Refresh and try again.",
    });
    expect(explainError(409, { error: "D1_ERROR: UNIQUE constraint failed: items.sku" }, "x").message).toBe(
      "That already exists.",
    );
  });

  it("reads better-auth style `message` bodies and non-object bodies", () => {
    expect(explainError(400, { message: "Password too short" }, "x").message).toBe("Password too short.");
    expect(explainError(400, "nope", "Something odd").message).toBe("Something odd.");
    expect(explainError(400, [1, 2], "Something odd").message).toBe("Something odd.");
  });
});

describe("composeErrorText and asSentence", () => {
  it("joins the sentence and the fix with one space", () => {
    expect(composeErrorText({ message: "Only 3 LAMP are left to pick on this order.", hint: "Lower the qty to 3 or less." })).toBe(
      "Only 3 LAMP are left to pick on this order. Lower the qty to 3 or less.",
    );
    expect(composeErrorText({ message: "Bay is full.", hint: null })).toBe("Bay is full.");
  });

  it("capitalises and closes a sentence once", () => {
    expect(asSentence("  bay is   full ")).toBe("Bay is full.");
    expect(asSentence("Done.")).toBe("Done.");
    expect(asSentence("")).toBe("");
  });
});
