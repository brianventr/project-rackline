import { describe, expect, it } from "vitest";
import {
  GLOSSARY,
  glossaryEntry,
  glossaryPaletteSlot,
  glossaryPathFor,
  glossaryQueryText,
  isGlossaryQuestion,
  normalizeGlossaryText,
  searchGlossary,
} from "./glossary";
import { MODE_SWITCH_RULES } from "./operating-mode";

/** Office and floor routes in src/app/App.tsx that a glossary entry may link to. */
const ROUTES = new Set([
  "/today",
  "/exceptions",
  "/ship",
  "/live",
  "/floor",
  "/floor/pick",
  "/floor/lookup",
  "/floor/adjust",
  "/map",
  "/analytics/traffic",
  "/analytics/runway",
  "/analytics/promise",
  "/inbound/receipts",
  "/inbound/asns",
  "/inbound/yard",
  "/inbound/putaway",
  "/inbound/purchases",
  "/inbound/vendors",
  "/inbound/vendor-returns",
  "/stock",
  "/stock/items",
  "/stock/locations",
  "/stock/counts",
  "/stock/holds",
  "/stock/plates",
  "/stock/replenish",
  "/stock/ledger",
  "/make/recipes",
  "/make/work-orders",
  "/make/kits",
  "/outbound/orders",
  "/outbound/waves",
  "/outbound/returns",
  "/outbound/customers",
  "/setup/shopify",
  "/setup/carriers",
  "/setup/warehouse",
  "/setup/shipping-rules",
  "/setup/clients",
  "/setup/zones",
  "/setup/edi",
  "/setup/integrations",
]);

function top(query: string): string | undefined {
  return searchGlossary(query)[0]?.id;
}

describe("GLOSSARY", () => {
  it("covers at least 25 terms with unique ids", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(25);
    const ids = GLOSSARY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never gives two entries the same word", () => {
    const seen = new Map<string, string>();
    for (const entry of GLOSSARY) {
      for (const name of [entry.term, ...entry.aliases]) {
        const key = normalizeGlossaryText(name).replace(/ /g, "");
        const owner = seen.get(key);
        expect(owner === undefined || owner === entry.id, `${name} is on ${owner} and ${entry.id}`).toBe(true);
        seen.set(key, entry.id);
      }
    }
  });

  it("writes short, plain sentences in product voice", () => {
    for (const entry of GLOSSARY) {
      expect(entry.short.length, entry.id).toBeLessThanOrEqual(160);
      expect(entry.short.endsWith("."), entry.id).toBe(true);
      expect(`${entry.short} ${entry.long ?? ""}`, entry.id).not.toContain("!");
      if (entry.long) expect(entry.long.endsWith("."), entry.id).toBe(true);
    }
  });

  it("says Garage Mode changes the ship, scan, and office rules, not only the menu", () => {
    const garage = glossaryEntry("garage-mode")!;
    expect(garage.short).toContain("one-click ship");
    expect(garage.short).toContain("optional scans");
    expect(garage.short).toContain("office pick and pack");
    expect(garage.long).toContain(MODE_SWITCH_RULES);
  });

  it("says a hold blocks stock rather than skipping it", () => {
    const hold = glossaryEntry("hold")!;
    expect(hold.short).toContain("cannot take it");
    expect(hold.short).toContain("work order");
    expect(hold.short).not.toMatch(/skip/i);
    expect(hold.long).toContain("HELD_STOCK");
  });

  it("links only to pages that exist", () => {
    for (const entry of GLOSSARY) {
      if (entry.path) expect(ROUTES.has(entry.path), `${entry.id} → ${entry.path}`).toBe(true);
    }
  });
});

describe("searchGlossary", () => {
  it("finds every warehouse word the app puts on screen", () => {
    const expected: [string, string][] = [
      ["ATP", "atp"],
      ["allocation", "allocation"],
      ["ASN", "asn"],
      ["SSCC", "sscc"],
      ["vendor carton", "sscc"],
      ["RTV", "rtv"],
      ["RMA", "rma"],
      ["disposition", "disposition"],
      ["FEFO", "fefo"],
      ["expiry", "expiry"],
      ["lot", "lot"],
      ["serial", "serial"],
      ["catch-weight", "catch-weight"],
      ["blind count", "blind-count"],
      ["variance", "variance"],
      ["hold", "hold"],
      ["pick face", "pick-face"],
      ["bulk bay", "bulk-bay"],
      ["replenish", "replenish"],
      ["putaway", "putaway"],
      ["wave", "wave"],
      ["batch pick", "batch-pick"],
      ["kit", "kit"],
      ["dekit", "dekit"],
      ["recipe", "recipe"],
      ["BOM", "recipe"],
      ["work order", "work-order"],
      ["as-built", "as-built"],
      ["3PL client", "3pl-client"],
      ["yard visit", "yard-visit"],
      ["dock", "dock"],
      ["cutoff", "cutoff"],
      ["pickup", "cutoff"],
      ["promise", "promise"],
      ["runway", "runway"],
      ["reorder point", "reorder-point"],
      ["Garage Mode", "garage-mode"],
      ["short ship", "short-ship"],
      ["backorder", "backorder"],
      ["carton", "carton"],
      ["BOX-n", "carton"],
      ["unpick", "unpick"],
      ["license plate", "license-plate"],
      ["LPN", "license-plate"],
      ["tote", "license-plate"],
      ["pallet qty", "pack-size"],
      ["shipping rule", "ship-rule"],
      ["shipping rules", "ship-rule"],
      ["hold for review", "ship-rule"],
      ["rate choice", "rate-choice"],
      ["cheapest", "rate-choice"],
      ["auto box", "auto-box"],
      ["box preset", "auto-box"],
      ["scan to ship", "scan-to-ship"],
      ["auto-ship", "scan-to-ship"],
      ["scale", "scale"],
      ["use scale weight", "scale"],
      ["HS code", "hs-code"],
      ["tariff code", "hs-code"],
      ["CN22", "customs-form"],
      ["commercial invoice", "customs-form"],
      ["address check", "address-check"],
      ["suggested address", "address-check"],
      ["ship anyway to this address", "address-check"],
      ["tracking page", "tracking-page"],
      ["copy tracking link", "tracking-page"],
      ["brand colour", "tracking-page"],
      ["return label", "return-label"],
      ["copy customer link", "return-label"],
      ["scan session", "scan-session"],
      ["tracker webhook", "tracker-webhook"],
      ["exception inbox", "exception-inbox"],
      ["exceptions", "exception-inbox"],
      ["needs attention", "exception-inbox"],
      ["snooze", "exception-inbox"],
      ["offline queue", "offline-queue"],
      ["pending post", "offline-queue"],
    ];
    for (const [query, id] of expected) expect(top(query), query).toBe(id);
  });

  it("ignores case, punctuation, and spacing", () => {
    expect(top("atp")).toBe("atp");
    expect(top("  Atp ")).toBe("atp");
    expect(top("catch weight")).toBe("catch-weight");
    expect(top("catchweight")).toBe("catch-weight");
    expect(top("As built")).toBe("as-built");
    expect(top("put away")).toBe("putaway");
  });

  it("reads questions", () => {
    expect(top("what is fefo")).toBe("fefo");
    expect(top("What's ATP?")).toBe("atp");
    expect(top("what is a wave")).toBe("wave");
    expect(top("what does RTV stand for")).toBe("rtv");
    expect(top("define blind count")).toBe("blind-count");
    expect(top("what does sscc mean?")).toBe("sscc");
  });

  it("matches expansions and prefixes", () => {
    expect(top("available to promise")).toBe("atp");
    expect(top("advance ship")).toBe("asn");
    expect(top("return to vendor")).toBe("rtv");
    expect(top("first expired")).toBe("fefo");
    expect(top("bill of materials")).toBe("recipe");
    expect(top("genealogy")).toBe("as-built");
    expect(top("dekit")).toBe("dekit");
    expect(top("repl")).toBe("replenish");
  });

  it("puts the closest match first", () => {
    const pick = searchGlossary("pick").map((entry) => entry.id);
    expect(pick.slice(0, 3).sort()).toEqual(["pick-face", "pick-list", "pick-min"]);
    expect(pick).toContain("batch-pick");
    expect(pick.indexOf("pick-face")).toBeLessThan(pick.indexOf("batch-pick"));
    expect(top("batch")).toBe("batch-pick");
    expect(top("return")).toBe("rma");
    expect(top("bo")).toBe("backorder");
    expect(top("box")).toBe("carton");
  });

  it("returns nothing for blanks and misses", () => {
    expect(searchGlossary("")).toEqual([]);
    expect(searchGlossary("   ")).toEqual([]);
    expect(searchGlossary("?")).toEqual([]);
    expect(searchGlossary("zzqx")).toEqual([]);
    expect(searchGlossary("ORD-DEMO1")).toEqual([]);
  });
});

describe("glossaryEntry", () => {
  it("looks up by id", () => {
    expect(glossaryEntry("atp")?.term).toBe("ATP");
    expect(glossaryEntry("catch-weight")?.term).toBe("Catch-weight");
    expect(glossaryEntry("nope")).toBeUndefined();
    expect(glossaryEntry("")).toBeUndefined();
  });

  it("also accepts the word on screen", () => {
    expect(glossaryEntry("ATP")?.id).toBe("atp");
    expect(glossaryEntry("BOM")?.id).toBe("recipe");
    expect(glossaryEntry("SSCC")?.id).toBe("sscc");
    expect(glossaryEntry("Pick face")?.id).toBe("pick-face");
    expect(glossaryEntry("pick_face")?.id).toBe("pick-face");
  });
});

describe("question helpers", () => {
  it("strips filler words but keeps a bare filler query", () => {
    expect(glossaryQueryText("What is FEFO?")).toBe("fefo");
    expect(glossaryQueryText("what does atp mean")).toBe("atp");
    expect(glossaryQueryText("what")).toBe("what");
    expect(glossaryQueryText("hold")).toBe("hold");
  });

  it("spots a question", () => {
    expect(isGlossaryQuestion("what is fefo")).toBe(true);
    expect(isGlossaryQuestion("What's ATP")).toBe(true);
    expect(isGlossaryQuestion("atp?")).toBe(true);
    expect(isGlossaryQuestion("define lot")).toBe(true);
    expect(isGlossaryQuestion("atp")).toBe(false);
    expect(isGlossaryQuestion("whatever")).toBe(false);
    expect(isGlossaryQuestion("")).toBe(false);
  });
});

describe("glossaryPaletteSlot", () => {
  const idle = { pageOrActionMatches: 0, searchingRecords: false };

  it("never puts a plain word ahead of the page with that name", () => {
    // Page names that are also glossary words: Enter must still navigate.
    const titles = [
      "Waves", "Kits", "Recipes", "Counts", "Zones", "Yard", "Ledger", "Promise", "Runway",
      "Putaway", "Replenish", "EDI", "On hand", "Buy parts", "Receive", "Builds", "atp", "bom", "Exceptions",
    ];
    for (const title of titles) {
      expect(searchGlossary(title).length, title).toBeGreaterThan(0);
      expect(glossaryPaletteSlot(title, { pageOrActionMatches: 1, searchingRecords: false }), title).toBe("last");
    }
  });

  it("waits for the record search on a plain query", () => {
    expect(glossaryPaletteSlot("carton", { pageOrActionMatches: 0, searchingRecords: true })).toBe("hidden");
    expect(glossaryPaletteSlot("carton", idle)).toBe("last");
    expect(glossaryPaletteSlot("fefo", idle)).toBe("last");
  });

  it("leads with the Glossary only for a question no page or action answers", () => {
    expect(glossaryPaletteSlot("what is fefo", idle)).toBe("first");
    expect(glossaryPaletteSlot("what is fefo", { pageOrActionMatches: 0, searchingRecords: true })).toBe("first");
    expect(glossaryPaletteSlot("atp?", idle)).toBe("first");
    expect(glossaryPaletteSlot("what is a wave", { pageOrActionMatches: 1, searchingRecords: false })).toBe("last");
  });
});

describe("glossaryPathFor", () => {
  const owner = { role: "owner", garage: false };
  const operator = { role: "operator", garage: false };
  const garageOwner = { role: "owner", garage: true };

  it("links to the entry's page when this person can open it", () => {
    expect(glossaryPathFor(glossaryEntry("atp")!, owner)).toBe("/stock");
    expect(glossaryPathFor(glossaryEntry("atp")!, operator)).toBe("/stock");
    expect(glossaryPathFor(glossaryEntry("garage-mode")!, garageOwner)).toBe("/setup/warehouse");
  });

  it("drops owner pages for operators", () => {
    expect(glossaryPathFor(glossaryEntry("garage-mode")!, operator)).toBeNull();
    expect(glossaryPathFor(glossaryEntry("adjustment")!, operator)).toBeNull();
    expect(glossaryPathFor(glossaryEntry("adjustment")!, owner)).toBe("/floor/adjust");
    expect(glossaryPathFor(glossaryEntry("ship-rule")!, operator)).toBeNull();
    expect(glossaryPathFor(glossaryEntry("ship-rule")!, owner)).toBe("/setup/shipping-rules");
  });

  it("drops pages Garage Mode packs away", () => {
    expect(glossaryPathFor(glossaryEntry("asn")!, garageOwner)).toBeNull();
    expect(glossaryPathFor(glossaryEntry("hold")!, garageOwner)).toBeNull();
    expect(glossaryPathFor(glossaryEntry("asn")!, owner)).toBe("/inbound/asns");
  });

  it("drops the ship queue in Manufacturer", () => {
    expect(glossaryPathFor(glossaryEntry("quick-ship")!, garageOwner)).toBe("/ship");
    expect(glossaryPathFor(glossaryEntry("quick-ship")!, owner)).toBeNull();
    expect(glossaryPathFor(glossaryEntry("quick-ship")!, operator)).toBeNull();
    expect(glossaryPathFor(glossaryEntry("scan-to-ship")!, garageOwner)).toBe("/ship");
    expect(glossaryPathFor(glossaryEntry("scan-to-ship")!, owner)).toBeNull();
  });

  it("returns null when there is no page", () => {
    expect(glossaryPathFor(glossaryEntry("fefo")!, owner)).toBeNull();
  });
});
