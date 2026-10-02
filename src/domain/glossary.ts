import { MODE_SWITCH_RULES, garageAllowsPath, manufacturerRedirect } from "./operating-mode";

/**
 * Plain-language definitions for the warehouse words Rackline uses on screen.
 * `short` is what a hover card or the command palette shows; `long` adds how this app
 * behaves. `path` is the page that best shows the idea, when there is one.
 */
export type GlossaryEntry = { id: string; term: string; aliases: string[]; short: string; long?: string; path?: string };

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: "atp",
    term: "ATP",
    aliases: ["available to promise", "available", "available qty"],
    short: "Available to promise: what is in a bay minus held stock and qty already reserved for orders.",
    long: "Creating an order soft-reserves ATP. Pick start pins that reserve to a bay. A second order that would oversell is blocked (INSUFFICIENT_ATP). Asking Promise for a new qty does not reserve anything.",
    path: "/stock",
  },
  {
    id: "on-hand",
    term: "On hand",
    aliases: ["onhand", "on hand qty", "balance", "stock on hand", "soh"],
    short: "Pieces physically in a bay, summed from the movement ledger. It still counts held and reserved stock.",
    path: "/stock",
  },
  {
    id: "allocation",
    term: "Allocation",
    aliases: ["reservation", "reserve", "reserved", "allocated"],
    short: "Qty set aside for one order. A soft reserve is taken when the order is created and counts against ATP without pinning a bay.",
    long: "Pick start turns the soft reserve into a bay allocation. Pick, move, replenish, kit, work order, and RTV cannot take another order's reservation. Cancel releases it. A short order still ingests; only the qty ATP can cover is reserved.",
    path: "/outbound/orders",
  },
  {
    id: "sellable",
    term: "Sellable qty",
    aliases: ["sellable", "available to sell", "shopify qty", "shopify inventory"],
    short: "What Rackline pushes to Shopify: on hand minus held minus qty still to pick on open orders.",
    long: "It updates after stock posts, Shopify orders, holds, and cancels. SKUs without a Shopify inventory item are skipped.",
    path: "/setup/shopify",
  },
  {
    id: "quick-ship",
    term: "Quick ship",
    aliases: ["ship queue", "one-click ship", "create labels", "ship"],
    short: "Garage Mode's one-step ship: pick from the suggested shelf, pack, buy the label, and mark the order shipped.",
    long: "Weight comes from each SKU's ship weight plus the box. Lots and serials are taken first-expiring first; weighed SKUs and boxed orders still go through the floor. Manufacturer mode ships through the floor instead.",
    path: "/ship",
  },
  {
    id: "sku",
    term: "SKU",
    aliases: ["stock keeping unit", "item", "product", "part"],
    short: "One thing you stock, make, or ship. Its barcode defaults to the SKU code.",
    long: "Each SKU is raw, WIP, packaging, or finished, and can track lots, serials, expiry, or catch-weight.",
    path: "/stock/items",
  },
  {
    id: "wip",
    term: "WIP",
    aliases: ["work in progress", "subassembly", "sub assembly"],
    short: "A part-built SKU with its own recipe that goes into another build.",
    path: "/make/recipes",
  },
  {
    id: "ledger",
    term: "Ledger",
    aliases: ["movement ledger", "movements", "stock history", "inventory ledger"],
    short: "The append-only list of every receive, move, pick, ship, build, and adjustment. On hand is the sum of it.",
    path: "/stock/ledger",
  },
  {
    id: "bin",
    term: "Bin",
    aliases: ["location", "bay", "slot", "storage location", "bin code", "location code"],
    short: "The scannable spot stock sits in: a bay at one level, or a dock, bench, or outbound bay. Its code is its barcode.",
    long: "Every bin has a type (receiving, storage, production, shipping) and can carry a slot role: pick face (where pickers take from) or bulk (the reserve that refills it). Qty always lives on a SKU in a bin, never on the SKU alone.",
    path: "/stock/locations",
  },
  {
    id: "bin-address",
    term: "Bin address",
    aliases: ["aisle", "rack", "level", "address", "aisle rack bay level", "bay code", "a-01-02"],
    short: "A storage code reads aisle, rack, bay, level: A-01-02-2 is aisle A, rack 01, bay 02, second shelf up. Level 1 is left off.",
    long: "Pick lists walk that order: aisle, then rack, then bay, then level. Build floor adds a whole rack of bays at once.",
    path: "/map",
  },
  {
    id: "dock",
    term: "Dock",
    aliases: ["receiving dock", "dock door", "receiving bay", "dock bay"],
    short: "A receiving bay where inbound stock lands before putaway. Today lists dock stock waiting to go to a bay.",
    long: "Trailers in the yard are assigned to a dock. Receipts, purchase orders, ASNs, and returns all receive onto one.",
    path: "/stock/locations",
  },
  {
    id: "receipt",
    term: "Receipt",
    aliases: ["rcp", "receiving", "receive"],
    short: "An inbound document (RCP-) listing what is coming in. Receive it on the dock, partials allowed.",
    long: "Each line tracks received against expected. Receiving more than is left is blocked (OVER_RECEIVE).",
    path: "/inbound/receipts",
  },
  {
    id: "purchase-order",
    term: "Purchase order",
    aliases: ["po", "purchase", "buy parts", "vendor order"],
    short: "What you ordered from a vendor (PO-). Send the draft to mint an expected ASN, then receive it on the dock.",
    long: "Draft PO on Today fills the gap up to each SKU's reorder point from the last vendor you bought it from.",
    path: "/inbound/purchases",
  },
  {
    id: "vendor",
    term: "Vendor",
    aliases: ["vendors", "supplier", "suppliers", "vendor record", "lead time", "payment terms"],
    short: "Who you buy from, with contact, terms, lead time, and the last price paid per part. Purchases link to it by name.",
    long: "Typing a new name on a purchase adds a vendor. Renaming a vendor changes new purchases; old ones keep the name they were sent with.",
    path: "/inbound/vendors",
  },
  {
    id: "customer",
    term: "Customer",
    aliases: ["customers", "buyer", "ship to", "customer record"],
    short: "Who you ship to, with a default ship-to and every order and return they have sent.",
    long: "Channel and CSV orders join a customer by email first, then by name and ship-to address when there is no email; otherwise they add one.",
    path: "/outbound/customers",
  },
  {
    id: "asn",
    term: "ASN",
    aliases: ["advance ship notice", "advance shipping notice", "vendor notice", "inbound notice"],
    short: "Advance ship notice: what a vendor says is on the truck. Receive it on the dock like a purchase order, partials allowed.",
    long: "Sending a PO mints an expected ASN for the remaining qty. Vendor boxes on an ASN are received one at a time.",
    path: "/inbound/asns",
  },
  {
    id: "sscc",
    term: "Vendor carton",
    aliases: ["sscc", "vendor box", "inbound carton", "asn carton", "serial shipping container code"],
    short: "A vendor box on an ASN, numbered BOX-n with an optional SSCC barcode. The dock receives and puts it away one box at a time.",
    long: "Once an ASN has boxes, loose receive is blocked (NEED_PACKAGE). A box still on the dock can be unreceived; one that was put away cannot.",
    path: "/inbound/asns",
  },
  {
    id: "edi",
    term: "EDI",
    aliases: ["electronic data interchange", "edi inbox", "supplier edi"],
    short: "A supplier posts its ASN to Rackline as JSON (no X12). Each one lands in the EDI inbox and creates an expected ASN.",
    path: "/setup/edi",
  },
  {
    id: "yard-visit",
    term: "Yard visit",
    aliases: ["yard", "trailer", "yrd", "gate check in", "trailer visit"],
    short: "A trailer's stay at your site (YRD-): expected, checked in at the gate, at a dock, then checked out.",
    long: "Assigning a dock ties a linked ASN to that dock so the floor receives it there.",
    path: "/inbound/yard",
  },
  {
    id: "putaway",
    term: "Putaway",
    aliases: ["put away", "transfer", "xfr", "bin to bin move"],
    short: "Moving stock off the dock onto a storage bay. Rackline suggests a bay: where the SKU already is, bulk first, near its pick face.",
    long: "Putaway tickets (XFR-) track moved against expected qty and stay in progress until every unit has left the from-bay.",
    path: "/inbound/putaway",
  },
  {
    id: "pick-face",
    term: "Pick face",
    aliases: ["pick bay", "forward pick", "pick slot", "pick location"],
    short: "The bay pickers take a SKU from. When it drops below the SKU's pick min, replenish tops it up from bulk.",
    path: "/stock/locations",
  },
  {
    id: "slotting",
    term: "Slotting",
    aliases: ["plan slotting", "pick-face assignment", "velocity slotting"],
    short: "Opens a transfer that puts a fast SKU on a pick face. Stock does not move until that transfer is posted.",
    long: "The rank is picks and shipments over the last 30 days, the same movement ABC uses. The move is from the bulk bay onto an empty pick face, or one whose SKU is slower. A SKU already on a pick face is skipped, and a slower SKU never displaces a faster one. Qty is what is available in bulk, capped by the pick face max when it is set. Planning again does not open a second transfer for the same SKU and destination. Manufacturer only.",
    path: "/stock/locations",
  },
  {
    id: "bulk-bay",
    term: "Bulk bay",
    aliases: ["bulk", "bulk storage", "reserve storage", "overstock"],
    short: "A storage bay that holds extra stock. Putaway prefers bulk; replenish moves it from bulk to the pick face.",
    path: "/stock/locations",
  },
  {
    id: "bin-capacity",
    term: "Bin capacity",
    aliases: ["capacity", "max qty", "max weight", "max volume", "fill percent", "bay limit", "location full"],
    short: "An optional limit on a bay's units, weight, or volume. A receive or move that would pass it is refused unless an owner overrides.",
    long: "Fill is the bay's stock times each item's weight and size, taken from the item or its pack sizes; an item with neither counts only toward units. Putaway skips full bays and prefers ones with room, and every override is written to the audit log.",
    path: "/stock/locations",
  },
  {
    id: "license-plate",
    term: "License plate",
    aliases: ["plate", "plates", "lpn", "license plate number", "lp code", "tote", "pallet", "pallet id"],
    short: "A tote, pallet, or carton with an LP- code that groups stock in one bay. Scan it to move everything on it at once, or to pick from it.",
    long: "A plate's lines are a share of its bay's balance, never more, so building or breaking one changes neither on hand nor available. Moving a plate posts normal ledger moves, so holds and bin capacity apply. Picks take loose stock first unless a plate is scanned.",
    path: "/stock/plates",
  },
  {
    id: "pick-min",
    term: "Pick min",
    aliases: ["pick minimum", "min qty"],
    short: "The fewest pieces a SKU's pick face should hold. When it drops below, a replenishment is due.",
    path: "/stock/replenish",
  },
  {
    id: "replenish",
    term: "Replenish",
    aliases: ["replenishment", "top up", "rpl"],
    short: "Move stock from a bulk bay onto a pick face that is below the SKU's pick min (RPL-). Partial moves are allowed.",
    long: "Different from dock putaway: replenish only feeds pick faces.",
    path: "/stock/replenish",
  },
  {
    id: "zone",
    term: "Zone",
    aliases: ["zones", "area", "pick zone"],
    short: "A named group of bays, like an aisle or area. A wave scoped to a zone prefers its bays for picks.",
    path: "/setup/zones",
  },
  {
    id: "lot",
    term: "Lot",
    aliases: ["lot code", "lot number", "batch number", "batch code"],
    short: "A vendor batch code on stock for lot-tracked SKUs. Receive needs one; pick and move take the oldest lot when none is scanned.",
    path: "/floor/lookup",
  },
  {
    id: "serial",
    term: "Serial",
    aliases: ["serial number", "serials", "serialized", "sn"],
    short: "A unique code on each unit of a serial-tracked SKU. Receive needs one serial per piece.",
    long: "Lookup shows what a serial was built from and what it went into.",
    path: "/floor/lookup",
  },
  {
    id: "expiry",
    term: "Expiry",
    aliases: ["expiration", "expiry date", "expires on", "best before", "use by", "expiring"],
    short: "A date on each lot of an expiry-tracked SKU. Expired lots are skipped on pick; Today lists lots expiring within 14 days.",
    path: "/stock/items",
  },
  {
    id: "fefo",
    term: "FEFO",
    aliases: ["first expired first out", "first expiry first out", "earliest expiry"],
    short: "First expired, first out: pick takes the lot with the earliest expiry date first and skips expired stock.",
    long: "Lots that expire before an order would ship do not count toward Promise or Runway cover.",
  },
  {
    id: "fifo",
    term: "FIFO",
    aliases: ["first in first out", "oldest lot"],
    short: "First in, first out: when no lot or serial is scanned, pick and move take the oldest one first.",
  },
  {
    id: "catch-weight",
    term: "Catch-weight",
    aliases: ["catch weight", "variable weight", "weight in grams", "weigh"],
    short: "A SKU counted in whole pieces whose weight varies. Enter grams on receive, pick, and count.",
    long: "The weight is copied onto ship and shown on the document and ledger. Qty stays in pieces.",
    path: "/stock/items",
  },
  {
    id: "alt-unit",
    term: "Alt unit",
    aliases: ["alt uom", "uom", "unit of measure", "case qty", "dual uom"],
    short: "An optional second unit on a SKU, like a case of 12. Receive and pick accept it and convert to stock pieces.",
    path: "/stock/items",
  },
  {
    id: "pack-size",
    term: "Pack size",
    aliases: ["pack sizes", "inner pack", "case pack", "pallet qty", "case barcode", "case label"],
    short: "The inner, case, and pallet an item comes in, each with its eaches and an optional barcode. Scanning a pack counts all its eaches.",
    long: "Stock is always kept in eaches. Each level holds whole packs of the one below it, and the case becomes the item's alt unit.",
    path: "/stock/items",
  },
  {
    id: "cycle-count",
    term: "Cycle count",
    aliases: ["count", "counts", "stock take", "stocktake"],
    short: "Count one bay without stopping work. Posting adjusts on hand to what was counted.",
    long: "A SKU that was not on the bay's snapshot can be scanned or added. Posting adjusts against current on hand, so moves during the count are not double-counted. Manufacturer can plan counts from movement: A every 7 days, B every 30, C every 90.",
    path: "/stock/counts",
  },
  {
    id: "abc",
    term: "ABC count",
    aliases: ["abc", "abc class", "velocity class", "cycle class"],
    short: "A, B, and C from how fast a SKU moves. A is counted every 7 days, B every 30, C every 90.",
    long: "Class comes from picks and shipments over the last 30 days. The SKUs that make up the first 80% of that movement are A, the next through 95% are B, and the rest are C. Plan cycle counts opens a normal bay count. It skips a SKU that already has an open count or was counted inside its cadence. Manufacturer only.",
    path: "/stock/counts",
  },
  {
    id: "blind-count",
    term: "Blind count",
    aliases: ["blind", "blind cycle count"],
    short: "A count where the counter sees SKUs but not system qty until it is posted. Typing 0 is a real empty count.",
    path: "/stock/counts",
  },
  {
    id: "variance",
    term: "Variance",
    aliases: ["count variance", "discrepancy", "shrink", "over short"],
    short: "Counted qty minus system qty on a posted count. Today lists counts where they differ.",
    path: "/stock/counts",
  },
  {
    id: "adjustment",
    term: "Adjustment",
    aliases: ["adjust", "write off"],
    short: "A signed qty change on a bay with a reason. It cannot take a bay below zero.",
    path: "/floor/adjust",
  },
  {
    id: "qc-sample",
    term: "QC sample",
    aliases: ["sample percent", "incoming qc", "receive sample"],
    short: "Units pulled from a receipt for inspection. They stay unavailable until restocked, held, or scrapped. No return is opened.",
    long: "The percent is on the item. Blank is off, and 0 receives everything as usual. The receipt line id picks which units, so the same line always samples the same way. The receipt can finish while those units are still aside.",
    path: "/inbound/receipts",
  },
  {
    id: "hold",
    term: "Hold",
    aliases: ["qc hold", "quarantine", "lock", "held", "held stock"],
    short: "A lock on a bay, one SKU in a bay, or one lot. Pick, move, replenish, kit, work order, and RTV cannot take it; qty stays on the ledger.",
    long: "Taking held stock is blocked (HELD_STOCK) until the hold is released. Receive, count, adjust, produce, ship, and scrap still post. FIFO passes over a held lot when other lots cover the qty.",
    path: "/stock/holds",
  },
  {
    id: "wave",
    term: "Wave",
    aliases: ["wave pick", "wav", "waves"],
    short: "A group of open orders released to the floor together (WAV-). The wave completes when every order on it is picked.",
    path: "/outbound/waves",
  },
  {
    id: "batch-pick",
    term: "Batch pick",
    aliases: ["batch", "batch mode", "consolidated pick"],
    short: "A wave in batch mode: each SKU's qty is added up across the orders, picked in one trip, then spread back over those orders.",
    path: "/outbound/waves",
  },
  {
    id: "pick-list",
    term: "Pick list",
    aliases: ["pick ticket", "picking list", "walk"],
    short: "The printed walk for an order or wave: bay, SKU, remaining qty, and FEFO lots, in aisle, rack, bay, level order.",
    path: "/outbound/orders",
  },
  {
    id: "unpick",
    term: "Unpick",
    aliases: ["put back", "return to bay"],
    short: "Put picked but unpacked qty back on a bay. The order's reservation comes back with it.",
    path: "/outbound/orders",
  },
  {
    id: "carton",
    term: "Carton",
    aliases: ["box", "box-n", "package", "parcel", "outbound carton"],
    short: "An outbound box on an order (BOX-1, BOX-2) with its own weight, size, label, and tracking.",
    long: "Cartons are optional until the first one exists. Then every packed unit must be in a labeled box before ship.",
    path: "/outbound/orders",
  },
  {
    id: "pack-slip",
    term: "Pack slip",
    aliases: ["packing slip", "packing list"],
    short: "The paper in the box: ordered, picked, and packed qty, plus each BOX-n barcode and tracking.",
    path: "/outbound/orders",
  },
  {
    id: "ship-rule",
    term: "Shipping rule",
    aliases: ["ship rule", "ship rules", "shipping rules", "hold for review"],
    short: "An if-then for quick-ship: when an order's SKUs, weight, counts, ship-to, or channel match, use this box and service, or hold it for review.",
    long: "Rules run top to bottom and the first enabled match wins. Every condition you fill in must match, and a rule with none matches every order. A held order waits under Needs attention with the rule's name (SHIP_RULE_HOLD) until someone ships it anyway.",
    path: "/setup/shipping-rules",
  },
  {
    id: "rate-choice",
    term: "Rate choice",
    aliases: ["rate strategy", "cheapest rate", "fastest rate", "cheapest on time", "rate shopping"],
    short: "How quick-ship picks a service when no rule or order names one: the default service, or the cheapest, fastest, or cheapest on-time quote.",
    long: "Set it per building in Settings → Warehouse, or on a rule. Quotes come from every connected carrier account. On time means arriving by the day the order came in plus the building's delivery promise in working days. Once another carrier account is connected, Rackline Ground is never chosen.",
    path: "/setup/warehouse",
  },
  {
    id: "auto-box",
    term: "Auto box",
    aliases: ["automatic box", "box fit", "smallest box", "box preset", "box presets", "boxes"],
    short: "Quick-ship packs each order in the smallest saved box its items fit, by each SKU's ship size and the box's inside size and max weight.",
    long: "More than one unit may fill at most 80% of the box. An order with a SKU that has no ship size uses the default box, and one too big for every box ships on the default box with a warning. A box picked for the run or named by a rule wins.",
    path: "/ship",
  },
  {
    id: "scan-to-ship",
    term: "Scan to ship",
    aliases: ["scan station", "station mode", "pack bench", "auto-ship"],
    short: "The Ship queue's pack-bench mode: scan a pack slip, check the box, service, and weight Rackline chose, and press Enter to ship and print the label.",
    long: "A typed weight wins. Otherwise it waits for a connected scale to settle, or, with no scale, uses the ship weights plus the box. Owners can turn on auto-ship, which ships once the scale settles after the scan. Held orders need Ship anyway. Manufacturer turns it off along with quick-ship.",
    path: "/ship",
  },
  {
    id: "scale",
    term: "USB scale",
    aliases: ["scale", "postal scale", "shipping scale", "scale weight", "use scale weight", "webhid"],
    short: "A USB postal scale Rackline reads in Chrome or Edge on a computer. Use scale weight fills the parcel weight, rounded up to the next ounce.",
    long: "Connect scale asks the browser once; after that the scale is found again when the page opens. It shows on the order's Shipping tab, Floor Ship, and Scan to ship. Without one, type the weight.",
  },
  {
    id: "hs-code",
    term: "HS code",
    aliases: ["harmonized code", "harmonized system code", "tariff code", "hs tariff number", "schedule b"],
    short: "The 6 to 10 digit tariff number customs uses to classify a product, like 9405.20 for a desk lamp.",
    long: "Set it under Customs on the item's Settings, with the country of origin and the declared value per unit. An international label without them stops with CUSTOMS_REQUIRED, and the order waits under Needs attention.",
    path: "/stock/items",
  },
  {
    id: "customs-form",
    term: "Customs form",
    aliases: ["customs declaration", "cn22", "cn23", "commercial invoice", "declared value", "country of origin"],
    short: "The declaration that rides with an international parcel: what is inside, where it was made, and what it is worth.",
    long: "Rackline sends it with the label purchase whenever the ship-to country differs from the building's. When the carrier returns its own form, the label page links it to print with the label; otherwise the page prints Rackline's copy after the label.",
  },
  {
    id: "address-check",
    term: "Address check",
    aliases: [
      "address verification",
      "verify address",
      "suggested address",
      "use suggested address",
      "ship anyway to this address",
      "accept this address",
      "bad address",
    ],
    short: "Before a label, Rackline checks the ship-to for missing parts and typos, like a ZIP code in the wrong state, and asks EasyPost or ShipEngine when connected.",
    long: "A problem holds the order under Needs attention (ADDRESS_INVALID). Use suggested address takes the carrier's correction, Edit address fixes it by hand, and Ship anyway to this address ships it as it is. The order page offers the same in both modes, with Accept this address, which is how Manufacturer gets past it.",
    path: "/ship",
  },
  {
    id: "tracking-page",
    term: "Tracking page",
    aliases: ["tracking link", "copy tracking link", "customer tracking", "brand colour", "brand color", "shop logo"],
    short: "A public page for the customer with each package's carrier, tracking, and latest events, in the shop's colour and logo. It needs no sign-in.",
    long: "Copy tracking link on the order's menu, or Tracking link on the Ship queue's Shipped tab, copies it (/t/…). Each order has its own unguessable link, and the page never shows prices, the street, or the postcode. Set the colour and logo in Settings → Warehouse.",
    path: "/outbound/orders",
  },
  {
    id: "customer-email",
    term: "Customer email",
    aliases: ["shipment email", "delivery email", "shipping notification", "return label email", "notify customer"],
    short: "A message to the customer when an order ships, is out for delivery, arrives, hits a problem, or a return label is ready.",
    long: "Each one can send only when the store does not already notify, always, or never. Live Shopify, WooCommerce, and Etsy post-backs count as the store notifying. Set them in Settings, Warehouse, next to the tracking page. A failed send shows in Exceptions, where Resend tries again.",
    path: "/setup/warehouse",
  },
  {
    id: "short-ship",
    term: "Short ship",
    aliases: ["ship short", "partial ship"],
    short: "Close a packing order once at least one carton has left. Unshipped units go back to the bay and the rest becomes a backorder.",
    path: "/outbound/orders",
  },
  {
    id: "backorder",
    term: "Backorder",
    aliases: ["back order", "bo"],
    short: "The follow-up order a short ship creates for what did not leave (ORD-…-BO). It reserves stock only when its pick starts.",
    path: "/outbound/orders",
  },
  {
    id: "rma",
    term: "RMA",
    aliases: ["return merchandise authorization", "customer return", "return"],
    short: "A customer return. Receive it back into a bay and choose restock, scrap, or hold for each line.",
    path: "/outbound/returns",
  },
  {
    id: "disposition",
    term: "Disposition",
    aliases: ["return disposition", "restock", "scrap"],
    short: "What happens to a returned unit on receive: restock it in the bay, scrap it (on hand unchanged), or hold it for QC.",
    path: "/outbound/returns",
  },
  {
    id: "return-label",
    term: "Return label",
    aliases: ["return labels", "prepaid return label", "return shipping label", "rma label", "copy customer link"],
    short: "A prepaid label from the customer back to the building, bought on the RMA. The customer prints it from a link (/r/…) with no sign-in.",
    long: "Create return label on the return buys it through EasyPost, ShipEngine, FedEx, or Rackline Ground; direct UPS, DHL, and USPS accounts cannot yet. Void it from the same card before the customer uses it. The Returns list shows its tracking status.",
    path: "/outbound/returns",
  },
  {
    id: "rtv",
    term: "RTV",
    aliases: ["return to vendor", "vendor return", "vendor rtv"],
    short: "Return to vendor: stock leaves a bay and goes back to the supplier (RTV-). Partial qty is allowed; over-return is blocked.",
    path: "/inbound/vendor-returns",
  },
  {
    id: "recipe",
    term: "Recipe",
    aliases: ["bom", "bill of materials", "recipes", "kitting steps"],
    short: "What one unit of a finished or WIP SKU consumes, plus numbered steps for the bench. Kits and work orders build from it.",
    path: "/make/recipes",
  },
  {
    id: "nested-recipe",
    term: "Nested recipe",
    aliases: ["nested bom", "child work order", "build short sub-assemblies"],
    short: "A component with its own recipe. Build short sub-assemblies opens a child work order for the qty that is short.",
    long: "The parent still consumes that component, so completing it returns COMPONENT_SHORT and names the child until the component is on hand. Completing the child does not complete the parent. Only the direct components are opened, not every level. A cycle is refused, and a recipe stops at five levels.",
    path: "/make/recipes",
  },
  {
    id: "work-center",
    term: "Work center",
    aliases: ["work centers", "work centre", "bench routing"],
    short: "Where a recipe step is done. Stock stays on one ledger. The center is only a name on the step.",
    path: "/setup/warehouse",
  },
  {
    id: "work-order",
    term: "Work order",
    aliases: ["wo", "build", "builds", "assemble", "production order"],
    short: "A build of a finished SKU (WO-). Each complete takes recipe qty from the source bay and puts finished goods in the output bay.",
    long: "Partial completes are allowed; the work order stays in progress until the full qty is built.",
    path: "/make/work-orders",
  },
  {
    id: "kit",
    term: "Kit",
    aliases: ["kitting", "kit build", "kits"],
    short: "Assemble a finished SKU from its recipe (KIT-). Components leave one bay and finished kits land in another.",
    long: "Partial completes are allowed. Unlike a work order, a fully completed kit can be dekitted.",
    path: "/make/kits",
  },
  {
    id: "step-confirmation",
    term: "Step confirmation",
    aliases: ["step gate", "confirm step", "recipe step scan"],
    short: "Proof a recipe step was done for the units you are completing. Scan the component, or confirm a step that has no component. The photo is only a picture.",
    long: "Completing a kit or work order waits until every step is confirmed for that qty. One confirmation can cover the qty, or you can confirm one unit at a time. A recipe with no steps still completes. Both modes use the same check.",
    path: "/make/kits",
  },
  {
    id: "dekit",
    term: "Dekit",
    aliases: ["unkit", "break kit", "disassemble"],
    short: "Reverse a fully completed kit. Finished units leave the output bay and the same component lots and serials go back.",
    path: "/make/kits",
  },
  {
    id: "as-built",
    term: "As-built",
    aliases: ["as built", "genealogy", "traceability", "built from", "used in"],
    short: "The record of which component lots and serials went into each finished serial or lot. Scan either one in Lookup.",
    path: "/floor/lookup",
  },
  {
    id: "3pl-client",
    term: "3PL client",
    aliases: ["3pl", "client", "third party logistics", "client code"],
    short: "A brand you store and ship for. Its code tags orders, ASNs, and waves, and billing drafts one invoice per client.",
    long: "Stock stays on the same bays, tagged with its owner. A client's order only plans, reserves, and picks that client's stock, and your own orders skip client stock; outbound checks the owner's qty at the bay (CLIENT_STOCK).",
    path: "/setup/clients",
  },
  {
    id: "rate-card",
    term: "Rate card",
    aliases: ["client rate", "storage rate", "pick rate"],
    short: "What you charge a 3PL client for storage, picks, and cartons. A blank field uses the organization rate.",
    long: "The organization card is the default (storage 2¢, pick 25¢, carton $1.50 unless you change it). A client's own cents replace only the fields you set. Invoices for that client's activity use the card.",
    path: "/setup/clients",
  },
  {
    id: "client-portal",
    term: "Client portal",
    aliases: ["3pl portal", "client link"],
    short: "A read-only link for one 3PL client: on-hand totals, open orders, recent shipments, and that client's invoices.",
    long: "The link is 128 bits and is shown once. Rotate it to cut off the old one. It needs no sign-in, and it never shows another client, a street address, or an internal id.",
    path: "/setup/clients",
  },
  {
    id: "api-key",
    term: "API key",
    aliases: ["public api", "bearer key", "read api"],
    short: "A key other systems use to read orders, stock, or shipments. Rackline stores only its hash, and the secret is shown once.",
    long: "Send it as Authorization: Bearer. A missing or revoked key is refused. A key without the scope for that list is refused too. Pages are 50 rows, and the cursor does not carry an internal id.",
    path: "/setup/integrations",
  },
  {
    id: "outbound-webhook",
    term: "Outbound webhook",
    aliases: ["signed webhook", "rackline signature"],
    short: "An https call Rackline makes when an order is created, an order ships, or stock changes. The body is signed.",
    long: "The Rackline-Signature header is the hex HMAC-SHA256 of the raw body, using the secret shown when the endpoint was added. A failed delivery shows in Exceptions. Send again posts the same body. The user's action still finishes if the receiver is down.",
    path: "/setup/integrations",
  },
  {
    id: "job",
    term: "Floor job",
    aliases: ["job", "next job", "my jobs", "claim"],
    short: "One piece of floor work from an open document. Next job ranks them; your first scan or post claims it for you.",
    long: "A second person on a claimed job is blocked (JOB_CLAIMED). Unassigned work stays open to anyone.",
    path: "/floor",
  },
  {
    id: "exception-inbox",
    term: "Exception inbox",
    aliases: ["exceptions", "exception", "needs attention", "snooze", "resolve"],
    short: "Failed labels, stuck parcels, held stock, and other problems from every screen, in one list you claim like a job.",
    long: "Each problem is read live from where it lives, so fixing it there clears it on its own. Claim, snooze, or resolve it with a note; an owner can take over a claim. Garage leaves out counts, EDI, and bay capacity.",
    path: "/exceptions",
  },
  {
    id: "error-reference",
    term: "Error reference",
    aliases: ["error ref", "reference code", "something went wrong", "internal error"],
    short: "The 8-character code after “Something went wrong on our side.” Quote it, and the full error can be found in the Worker logs.",
    long: "A duplicate reads as CONFLICT and a record still in use as IN_USE, with no reference, because nothing crashed.",
  },
  {
    id: "scan-session",
    term: "Scan session",
    aliases: ["recorded scan", "floor scan", "server scan"],
    short: "The scans the server writes down while a Manufacturer pick, pack, or batch pick is open. The post checks those, not a list the browser sends.",
    long: "Each scan is stored as it happens, and sending the same scan id again is the same scan. A pick needs the bay and one scan of each SKU. A pack needs one scan per unit. The same serial cannot be scanned twice. Garage keeps posting its own evidence and does not open a session.",
    path: "/floor/pick",
  },
  {
    id: "tracker-webhook",
    term: "Tracker webhook",
    aliases: ["carrier webhook", "tracking webhook", "easypost webhook"],
    short: "The URL a carrier calls when a parcel moves. Each EasyPost or ShipEngine account has its own, and the secret on it is sealed.",
    long: "The older shared URL still works when the tracking number belongs to one live account. A secret saved before sealing still verifies, and is sealed the next time it is used.",
    path: "/setup/carriers",
  },
  {
    id: "cutoff",
    term: "Carrier cutoff",
    aliases: ["cutoff", "pickup", "carrier pickup", "last pickup"],
    short: "The daily carrier pickup, 3:00pm warehouse time. Promise quotes which pickup an order makes.",
    path: "/analytics/promise",
  },
  {
    id: "promise",
    term: "Promise",
    aliases: ["leave by", "ship date quote", "delivery promise"],
    short: "A leave-by quote for an open order or a new qty of a SKU, from the shelf, the pick queue, floor pace, and dated inbound.",
    long: "Creating an order soft-reserves ATP. The leave-by date is still a quote: it stays on the board, and asking about a new qty does not reserve anything.",
    path: "/analytics/promise",
  },
  {
    id: "runway",
    term: "Runway",
    aliases: ["days of cover", "stockout", "days until stockout", "cover"],
    short: "Days until a SKU runs out at its ship rate. Cover is sellable qty plus dated inbound, minus recipe burn and lots that expire first.",
    path: "/analytics/runway",
  },
  {
    id: "restock-forecast",
    term: "Restock forecast",
    aliases: ["reorder forecast", "make days", "ocean freight", "transit days", "order-by date"],
    short: "When to order a SKU so it arrives before the shelf runs out, counting make time and the shipment.",
    long: "House stock and each 3PL client's stock are forecast apart. A vendor lane is make days plus ocean, air, or ground. After a few containers arrive, the transit days become that vendor's own median. Alert lists it in Exceptions. Draft opens a purchase and does not send it.",
    path: "/analytics/restock",
  },
  {
    id: "reorder-point",
    term: "Reorder point",
    aliases: ["rop", "reorder", "low stock", "reorder queue"],
    short: "When on hand falls to this qty, the SKU joins Today's reorder queue. Draft PO orders the gap back up to it.",
    path: "/stock/items",
  },
  {
    id: "offline-queue",
    term: "Offline queue",
    aliases: ["offline post", "pending post", "pwa"],
    short: "A receive or pick saved on this device when the network drops, then sent in order once the connection returns.",
    long: "The post keeps an idempotency key, so sending it again returns the first outcome and does not receive or pick twice. Scans for a pick are sent before that pick. A server refusal stays on the floor until you dismiss it, and it is not retried.",
    path: "/floor",
  },
  {
    id: "garage-mode",
    term: "Garage Mode",
    aliases: ["garage", "bench", "founder bench", "full warehouse"],
    short: "The short setup new shops start in: one-click ship from the Ship queue, optional scans, and office pick and pack.",
    long: `Switch in Settings → Warehouse. ${MODE_SWITCH_RULES} It also opens yard, waves, ASNs, equipment, replenish, holds, counts, 3PL clients, EDI, and traffic on the same ledger.`,
    path: "/setup/warehouse",
  },
];

const BY_ID = new Map(GLOSSARY.map((entry) => [entry.id, entry]));

/** Lowercase, drop apostrophes, and turn every other symbol into a single space. */
export function normalizeGlossaryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const LEADING_FILLER = new Set([
  "what",
  "whats",
  "who",
  "is",
  "are",
  "does",
  "do",
  "a",
  "an",
  "the",
  "define",
  "definition",
  "meaning",
  "of",
  "explain",
  "glossary",
  "term",
  "tell",
  "me",
  "about",
]);
const TRAILING_FILLER = new Set(["mean", "means", "meaning", "stand", "stands", "for"]);

/** "What is FEFO?" → "fefo". Falls back to the whole query when it is only filler words. */
export function glossaryQueryText(query: string): string {
  const words = normalizeGlossaryText(query).split(" ").filter(Boolean);
  let start = 0;
  let end = words.length;
  while (start < end && LEADING_FILLER.has(words[start]!)) start += 1;
  while (end > start && TRAILING_FILLER.has(words[end - 1]!)) end -= 1;
  const core = words.slice(start, end);
  return (core.length ? core : words).join(" ");
}

/** True when the palette query reads like a question about a word, not a record search. */
export function isGlossaryQuestion(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  return /^(what|whats|what's|define|definition|meaning|explain|glossary)\b/i.test(trimmed);
}

function compact(text: string): string {
  return text.replace(/ /g, "");
}

function nameScore(name: string, q: string, isTerm: boolean): number {
  const n = normalizeGlossaryText(name);
  if (!n) return 0;
  const bonus = isTerm ? 5 : 0;
  const nc = compact(n);
  const qc = compact(q);
  if (n === q || nc === qc) return 95 + bonus;
  if (n.startsWith(q) || nc.startsWith(qc)) return 75 + bonus;
  const words = n.split(" ");
  if (n.includes(` ${q}`)) return 60 + bonus;
  const tokens = q.split(" ");
  if (tokens.length > 1 && tokens.every((token) => words.some((word) => word.startsWith(token)))) return 45 + bonus;
  if (q.length >= 3 && n.includes(q)) return 35 + bonus;
  return 0;
}

/** 0 when the entry does not match. Higher is better; the term outranks an alias of the same strength. */
export function glossaryScore(entry: GlossaryEntry, query: string): number {
  const q = glossaryQueryText(query);
  if (!q) return 0;
  let best = nameScore(entry.term, q, true);
  for (const alias of entry.aliases) best = Math.max(best, nameScore(alias, q, false));
  return best;
}

/** Entries whose term or an alias matches, best first. Blank queries return nothing. */
export function searchGlossary(query: string): GlossaryEntry[] {
  if (!glossaryQueryText(query)) return [];
  return GLOSSARY.map((entry, index) => ({ entry, index, score: glossaryScore(entry, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.entry);
}

/** Where the command palette puts its Glossary group, or "hidden" while it must wait. */
export type GlossaryPaletteSlot = "first" | "last" | "hidden";

/**
 * Many page names are also glossary words (Waves, Ledger, Receive), so a plain query never lets the
 * Glossary take the first slot: it goes after Records, Actions, and Go to, and waits for the record
 * search so a matching SKU, bay, or order is still what Enter opens. Only a question ("what is fefo")
 * leads with the Glossary, and only when no page or action matches the text.
 */
export function glossaryPaletteSlot(
  query: string,
  palette: { pageOrActionMatches: number; searchingRecords: boolean },
): GlossaryPaletteSlot {
  if (isGlossaryQuestion(query)) return palette.pageOrActionMatches > 0 ? "last" : "first";
  return palette.searchingRecords ? "hidden" : "last";
}

/** Look up by id. Also accepts an exact term or alias ("BOM", "SSCC") so callers can pass the word they show. */
export function glossaryEntry(id: string): GlossaryEntry | undefined {
  const direct = BY_ID.get(id);
  if (direct) return direct;
  const wanted = normalizeGlossaryText(id);
  if (!wanted) return undefined;
  const byId = GLOSSARY.find((entry) => normalizeGlossaryText(entry.id) === wanted);
  if (byId) return byId;
  return GLOSSARY.find(
    (entry) =>
      normalizeGlossaryText(entry.term) === wanted || entry.aliases.some((alias) => normalizeGlossaryText(alias) === wanted),
  );
}

/** Routes only an owner can open (they redirect operators home). */
const OWNER_ONLY_PREFIXES = ["/setup", "/live", "/labor", "/floor/adjust"];

function isOwnerOnlyPath(path: string): boolean {
  const bare = path.split(/[?#]/)[0] ?? path;
  return OWNER_ONLY_PREFIXES.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
}

/**
 * The entry's page if this person can open it: owners-only pages drop for operators, packed-away pages
 * drop in Garage Mode, and Garage-only pages (the ship queue) drop in Manufacturer.
 */
export function glossaryPathFor(entry: GlossaryEntry, viewer: { role: string; garage: boolean }): string | null {
  const path = entry.path;
  if (!path) return null;
  if (viewer.role !== "owner" && isOwnerOnlyPath(path)) return null;
  if (viewer.garage && !garageAllowsPath(path)) return null;
  if (!viewer.garage && manufacturerRedirect(path)) return null;
  return path;
}
