/**
 * Marketing page catalog — industries, use cases, compare pages.
 * Used by React routes and Worker SEO HTML injection.
 */

export type MarketingSection = {
  heading: string;
  body: string;
  bullets?: string[];
};

export type MarketingFaq = { q: string; a: string };

export type MarketingPage = {
  slug: string;
  path: string;
  kind: "industry" | "use-case" | "compare" | "guide";
  navGroup: "Industries" | "Use cases" | "Compare" | "Guides";
  title: string;
  description: string;
  h1: string;
  lede: string;
  primaryKeyword: string;
  keywords: string[];
  features: { title: string; body: string }[];
  dayInLife?: MarketingSection;
  sections?: MarketingSection[];
  faqs: MarketingFaq[];
  related: string[];
  ctaLabel?: string;
};

export const MARKETING_PAGES: MarketingPage[] = [
  // —— Wave A ——
  {
    slug: "makers",
    path: "/industries/makers",
    kind: "industry",
    navGroup: "Industries",
    title: "Maker Inventory Software & WMS | Rackline WMS",
    description:
      "Warehouse software for makers who outgrew spreadsheets. Garage Mode, bin locations, Shopify, and BOMs on one ledger.",
    h1: "Warehouse software for makers who outgrew spreadsheets",
    lede: "Start on a bench and a few shelves. Receive parts, kit finished goods, pick Shopify orders, and open a full warehouse on the same ledger when the garage runs out of room.",
    primaryKeyword: "maker inventory software",
    keywords: ["maker WMS", "garage warehouse software", "inventory software for makers", "light manufacturing WMS"],
    features: [
      { title: "Garage Mode", body: "Founder bench: receive, make, pick, pack, ship — without yard, waves, or 3PL noise." },
      { title: "Physical locations", body: "Aisle, rack, bay, level. Stock never lives on the item record alone." },
      { title: "Shopify to pick ticket", body: "Checkouts land as orders. After ship, fulfillment posts back." },
      { title: "BOMs and kits", body: "Assemble what you sell. As-built genealogy when a kit completes." },
    ],
    dayInLife: {
      heading: "A maker day on Rackline",
      body: "Receive LED bulbs to a bay. Complete a lamp kit on the bench. Pick the Shopify order from the pick face. Buy a label. Ship. Promise told the customer the leave-by before you started.",
    },
    faqs: [
      {
        q: "Is Rackline inventory software or a WMS?",
        a: "Both. Maker inventory tools often stop at recipes and counts. Rackline is a warehouse management system — directed locations, scan-to-move, pick/pack/ship — that still speaks maker language.",
      },
      {
        q: "Do I need a warehouse building?",
        a: "No. New organizations start in Garage Mode. Open the full warehouse later on the same ledger.",
      },
      {
        q: "How is this different from Craftybase or Katana?",
        a: "Craftybase owns COGS recipes. Katana owns production planning. Rackline owns the floor: bins, FEFO, Promise leave-by, and Shopify fulfillment.",
      },
    ],
    related: ["garage-warehouse", "shopify-wms", "kit-assembly"],
  },
  {
    slug: "garage-warehouse",
    path: "/use-cases/garage-warehouse",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Garage Warehouse Software | Rackline WMS",
    description:
      "Start in Garage Mode. Grow into a real warehouse on the same inventory ledger. Bin locations, scan-to-move, and Shopify for founders.",
    h1: "Start in Garage Mode. Grow into a real warehouse.",
    lede: "Founders and inventors do not lease a DC on day one. Rackline starts where you are — a bench, shelves, and a real ledger — then unlocks yard, waves, ASN, and equipment when you lease a floor.",
    primaryKeyword: "garage warehouse software",
    keywords: ["garage fulfillment software", "small warehouse management for startups", "warehouse software for startups"],
    features: [
      { title: "Same ledger forever", body: "Opening Manufacturer mode does not migrate inventory. Qty stays on location:item." },
      { title: "Floor map when you need it", body: "Build racks and bays in the editor. Compass-aware floor plan and 3D racks." },
      { title: "HID scanners, no extra app", body: "USB and Bluetooth guns work on every screen." },
      { title: "Today and Live", body: "Dispatch board for the day; Live wall for pace and clear-by." },
    ],
    faqs: [
      {
        q: "What is Garage Mode?",
        a: "The founder bench. Receive, make, pick, and ship without a yard, waves, or a 3PL. Setup → Warehouse opens the full warehouse when you are ready.",
      },
      {
        q: "Can I run Shopify from a garage?",
        a: "Yes. Checkouts become pick tickets. Sellable qty pushes back. Carriers buy labels when you connect EasyPost, ShipEngine, or a direct account.",
      },
    ],
    related: ["makers", "shopify-wms", "kickstarter-fulfillment"],
  },
  {
    slug: "shopify-wms",
    path: "/use-cases/shopify-wms",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Shopify WMS for Small Manufacturers | Rackline WMS",
    description:
      "Shopify WMS for small manufacturers — not just sellers. Bin-level inventory, kits, FEFO, Promise leave-by, and fulfillment back to Shopify.",
    h1: "Shopify WMS for small manufacturers — not just sellers",
    lede: "Shopify tracks finished-goods quantity. Rackline tracks the floor: raw materials, BOM kits, bay locations, FEFO lots, and a leave-by promise your checkout can read.",
    primaryKeyword: "Shopify WMS",
    keywords: [
      "Shopify warehouse management",
      "Shopify WMS for small manufacturers",
      "Shopify kit assembly inventory",
      "Shopify BOM inventory",
      "Shopify FEFO lot tracking",
    ],
    features: [
      { title: "Checkout → pick ticket", body: "orders/create webhooks land as Rackline orders. ATP reserves when pick starts." },
      { title: "Sellable qty push", body: "On-hand − held − remaining-to-pick syncs to Shopify inventory." },
      { title: "Fulfillment back", body: "Per-carton tracking posts via fulfillmentCreate." },
      { title: "Promise ask API", body: "GET leave-by for a SKU qty — shelf, queue, pace, inbound — without reserving stock." },
    ],
    faqs: [
      {
        q: "Does Shopify need Stocky for this?",
        a: "No. Stocky stopped on August 31, 2026. Rackline covers purchase drafts, reorder/Runway, cycle counts, and a real warehouse — see our Stocky replacement page.",
      },
      {
        q: "Is this like ShipHero?",
        a: "ShipHero is fulfillment-first at mid-market prices. Rackline is maker-first: kits, Garage Mode, and floor maps without a $2k/mo starting point.",
      },
    ],
    related: ["stocky-replacement", "kit-assembly", "makers"],
  },
  // —— Wave B ——
  {
    slug: "kit-assembly",
    path: "/use-cases/kit-assembly",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Kit Assembly Warehouse Software | Rackline WMS",
    description:
      "Kit assembly warehouse for multi-SKU products. BOMs, directed kitting, dekit, and as-built genealogy on one ledger.",
    h1: "Kit assembly warehouse for multi-SKU products",
    lede: "Reward tiers, hardware kits, subscription boxes, gift sets — recipe to bay to box. Partial complete, dekit, and as-built lots stay on the same location:item ledger.",
    primaryKeyword: "kit assembly warehouse software",
    keywords: ["BOM inventory software", "kitting WMS", "buildable quantity inventory", "kit to order software"],
    features: [
      { title: "Recipes with steps and photos", body: "Floor Kit and Assemble show the photo, steps, and components." },
      { title: "Partial kit complete", body: "Header qty_completed vs qty; over-complete returns 409." },
      { title: "Dekit", body: "Reverse a fully completed kit from as-built lots and serials." },
      { title: "Genealogy lookup", body: "Scan a finished serial or lot; see built-from / used-in." },
    ],
    faqs: [
      {
        q: "Kit-to-stock or kit-to-order?",
        a: "Both patterns work. Build finished goods into a bay, or explode at fulfill time. Qty stays integer pieces on location:item.",
      },
    ],
    related: ["kickstarter-fulfillment", "subscription-boxes", "hardware-electronics"],
  },
  {
    slug: "kickstarter-fulfillment",
    path: "/use-cases/kickstarter-fulfillment",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Kickstarter Fulfillment Software | Rackline WMS",
    description:
      "Fulfill your Kickstarter from your own warehouse. Reward-tier kits, BackerKit import, wave pick, and leftover stock to Shopify.",
    h1: "Fulfill your Kickstarter from your own warehouse",
    lede: "3PLs win when you want to outsource the wave. Rackline wins when you want to kit tiers yourself, ship the wave, and keep leftovers sellable on Shopify — without enterprise WMS pricing.",
    primaryKeyword: "Kickstarter fulfillment software",
    keywords: [
      "in-house Kickstarter fulfillment",
      "crowdfunding reward tier kitting",
      "BackerKit inventory warehouse",
      "Gamefound inventory",
      "crowdfunding fulfillment software",
    ],
    features: [
      { title: "Pledge CSV import", body: "Import BackerKit, Gamefound, or Kickstarter-style exports into orders, kit recipes, and waves." },
      { title: "Tier → BOM", body: "Map reward tiers and add-ons to kit recipes before the ship window." },
      { title: "Wave / batch pick", body: "Group open pledges into WAV- batches; floor batch-pick spreads across orders." },
      { title: "Leftover → DTC", body: "After the wave, remaining finished goods stay on the ledger for Shopify." },
    ],
    sections: [
      {
        heading: "BackerKit and Gamefound",
        body: "Pledge managers export surveys, add-ons, and addresses. Rackline’s crowdfunding import maps those rows to SKUs, kit lines, and outbound orders — then Today and Floor run the wave.",
        bullets: ["CSV upload under Setup → Imports", "Tier code → recipe mapping", "Optional wave creation for the ship stage"],
      },
    ],
    faqs: [
      {
        q: "Is Rackline a crowdfunding 3PL?",
        a: "No. We are software for in-house crowdfunding fulfillment. If you later graduate to a 3PL, take the same SKU and lot discipline with you.",
      },
      {
        q: "Do you replace BackerKit?",
        a: "No. Keep BackerKit (or Gamefound) as the pledge manager. Rackline is the warehouse that receives the export.",
      },
    ],
    related: ["kit-assembly", "board-games", "shopify-wms"],
  },
  {
    slug: "stocky-replacement",
    path: "/use-cases/stocky-replacement",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Stocky Replacement for Shopify | Rackline WMS",
    description:
      "Stocky stopped August 31, 2026. Replace purchase orders, reorder, and stocktakes — and get a real warehouse with bins, kits, and Shopify fulfillment.",
    h1: "Stocky is gone. Get POs, reorder — and a real warehouse.",
    lede: "Shopify folded basic transfers and simple POs into Admin. What most merchants actually needed was demand-aware reorder and stocktakes. Rackline adds that plus bin locations, kits, and floor execution.",
    primaryKeyword: "Stocky replacement",
    keywords: ["Stocky alternative Shopify", "Shopify purchase orders warehouse", "Shopify stocktake software", "Stocky migration"],
    features: [
      { title: "Draft PO from Today", body: "Reorder queue drafts vendor POs from reorder point − on-hand." },
      { title: "Runway stockout", body: "Days-until-stockout from velocity, inbound, and BOM burn. Draft PO for order-today SKUs." },
      { title: "Blind cycle counts", body: "Floor counts hide system qty until post. Unexpected SKUs allowed." },
      { title: "Shopify channel", body: "OAuth install, sellable push, fulfillment back — beyond what Stocky ever was." },
    ],
    faqs: [
      {
        q: "Can I import Stocky history?",
        a: "Export POs and stocktakes from Stocky’s read-only window while it lasts. Rebuild suppliers in Rackline; use Draft PO and Runway going forward.",
      },
      {
        q: "Do I need Shopify POS Pro?",
        a: "No. Stocky required POS Pro. Rackline connects via Admin API / OAuth for online and multichannel sellers.",
      },
    ],
    related: ["shopify-wms", "makers", "garage-warehouse"],
  },
  // —— Wave C ——
  {
    slug: "beauty",
    path: "/industries/beauty",
    kind: "industry",
    navGroup: "Industries",
    title: "Indie Beauty Inventory & FEFO Warehouse | Rackline WMS",
    description:
      "FEFO warehouse for indie beauty founders. Lot tracking, QC holds, gift-set kits, and Shopify — MoCRA-era discipline without ERP theater.",
    h1: "FEFO warehouse for indie beauty founders",
    lede: "Shopify has no native batch expiry. Rackline picks earliest unexpired lots first, holds QC stock, kits gift sets, and ships DTC from bays you can scan.",
    primaryKeyword: "indie beauty inventory management",
    keywords: ["cosmetics lot tracking Shopify", "beauty brand FEFO warehouse", "skincare brand warehouse software", "MoCRA inventory lot tracking"],
    features: [
      { title: "Lot expiry / FEFO", body: "Flag a SKU, enter dates on receive, pick earliest unexpired first." },
      { title: "QC holds", body: "Lock a bay, SKU, or lot. Pick and kit skip it; qty stays on the ledger." },
      { title: "Gift-set kits", body: "BOM recipes for sets; as-built links finished kits to component lots." },
      { title: "Recall-ready lookup", body: "Floor Lookup scans a lot; genealogy shows built-from / used-in." },
    ],
    faqs: [
      {
        q: "Does this replace a cosmetic ERP?",
        a: "No. It replaces spreadsheet FEFO and Shopify qty lies. Formulation PLM stays upstream; Rackline runs the warehouse.",
      },
    ],
    related: ["food-beverage", "kit-assembly", "shopify-wms"],
  },
  {
    slug: "food-beverage",
    path: "/industries/food-beverage",
    kind: "industry",
    navGroup: "Industries",
    title: "Food & Coffee Lot Tracking Warehouse | Rackline WMS",
    description:
      "Lot-tracked warehouse for indie food, coffee, and supplement brands. FEFO pick, holds, ASN receive, and Shopify ship.",
    h1: "Lot-tracked warehouse for indie food & coffee brands",
    lede: "Green vs roasted, bagged vs bulk, supplement expiry — FEFO and lot genealogy on a maker-scale floor. Receive co-packer lots, kit samplers, ship DTC.",
    primaryKeyword: "coffee roaster inventory software",
    keywords: ["FEFO inventory software food", "food brand lot tracking", "supplement lot tracking", "small food manufacturer warehouse"],
    features: [
      { title: "FEFO pick", body: "Expired lots skipped; Today lists expiring cover." },
      { title: "Catch-weight overlay", body: "Optional grams on receive/pick/count for bottles and bags." },
      { title: "ASN / PO receive", body: "Partial receive, vendor cartons, putaway to suggested bays." },
      { title: "Runway", body: "Stockout math respects lots that expire before they would ship." },
    ],
    faqs: [
      {
        q: "Is this a roasting ERP?",
        a: "No. Roast profiles stay in your roast software. Rackline warehouses green, roasted, and packaged lots and ships them.",
      },
    ],
    related: ["beauty", "private-label", "shopify-wms"],
  },
  // —— Wave D ——
  {
    slug: "hardware-electronics",
    path: "/industries/hardware-electronics",
    kind: "industry",
    navGroup: "Industries",
    title: "Hardware Startup Inventory & Kit Warehouse | Rackline WMS",
    description:
      "From parts bins to packed kits — WMS for hardware makers. Locations, lot/serial, BOM kits, and Shopify fulfillment.",
    h1: "From parts bins to packed kits — WMS for hardware makers",
    lede: "PartsBox owns component libraries. Rackline owns what happens after: bays, kit builds, serials, and the Shopify order that leaves the bench.",
    primaryKeyword: "hardware startup inventory management",
    keywords: ["electronics kit inventory software", "PCB assembly inventory warehouse", "hardware maker WMS", "multi-SKU hardware kit inventory"],
    features: [
      { title: "Bin locations", body: "Reels and bags in bays; scan-to-move between bulk and pick face." },
      { title: "Serial and lot overlay", body: "Finished goods serials; component lots on as-built." },
      { title: "Work orders + kits", body: "Partial complete; floor Assemble and Kit with photos and steps." },
      { title: "Tindie / Shopify ready", body: "Ship DIY kits and assembled SKUs from the same ledger." },
    ],
    faqs: [
      {
        q: "Do you replace DigiKey / Mouser purchasing?",
        a: "Purchases and ASNs land parts on the dock. Supplier portals stay upstream.",
      },
    ],
    related: ["kit-assembly", "makers", "3d-printing"],
  },
  {
    slug: "board-games",
    path: "/industries/board-games",
    kind: "industry",
    navGroup: "Industries",
    title: "Board Game Fulfillment Software | Rackline WMS",
    description:
      "Tabletop creators: kit tiers, ship waves, keep leftovers sellable. Gamefound and Kickstarter-friendly warehouse software.",
    h1: "Kit tiers, ship waves, keep leftovers sellable",
    lede: "Stretch goals change kits mid-campaign. Rackline maps tiers to recipes, waves the ship stages, and leaves remaining stock ready for retail and Shopify.",
    primaryKeyword: "board game fulfillment software",
    keywords: ["Gamefound inventory", "tabletop publisher warehouse", "Kickstarter board game fulfillment inventory"],
    features: [
      { title: "Tier kits", body: "Base game + expansions + promos as BOM recipes." },
      { title: "Crowdfunding import", body: "Pledge CSV → orders and waves." },
      { title: "Wave pick", body: "EU/US ship stages as separate waves." },
      { title: "Afterlife DTC", body: "Leftovers stay on-hand for Shopify and Faire." },
    ],
    faqs: [
      {
        q: "How is this different from a tabletop 3PL?",
        a: "3PLs store and ship for you. Rackline is the system if you (or a partner warehouse you control) run the floor.",
      },
    ],
    related: ["kickstarter-fulfillment", "kit-assembly", "faire-wholesale"],
  },
  {
    slug: "subscription-boxes",
    path: "/use-cases/subscription-boxes",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Subscription Box Inventory & Kitting | Rackline WMS",
    description:
      "In-house subscription box kitting without a 3PL. Monthly kit recipes, wave pick, FEFO components, and Shopify.",
    h1: "In-house subscription box kitting — without a 3PL",
    lede: "Monthly themes are just kits on a schedule. Build the recipe, wave the subscribers, FEFO the dated inserts, ship from your own floor.",
    primaryKeyword: "subscription box inventory software",
    keywords: ["subscription box kitting warehouse", "monthly box fulfillment software"],
    features: [
      { title: "Kit recipes per theme", body: "Swap components monthly; keep the box SKU stable." },
      { title: "Batch / wave", body: "Release the month as a wave; floor batch-pick consolidates SKUs." },
      { title: "FEFO inserts", body: "Dated samples and snacks pick earliest first." },
      { title: "Cartons and labels", body: "BOX-n with weight/dims; carrier buy per carton." },
    ],
    faqs: [
      {
        q: "Do you bill subscribers?",
        a: "No. Shopify or your subscription app owns billing. Rackline owns the warehouse wave.",
      },
    ],
    related: ["kit-assembly", "shopify-wms", "beauty"],
  },
  {
    slug: "faire-wholesale",
    path: "/use-cases/faire-wholesale",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Faire Inventory Management for DTC Brands | Rackline WMS",
    description:
      "One inventory pool for Faire wholesale and DTC. Protect ATP, pick accurately, sync Shopify sellable qty.",
    h1: "One inventory pool for Faire wholesale and DTC",
    lede: "Wholesale POs drain the same shelves that Shopify sells. Rackline reserves ATP when pick starts, so a second channel cannot silently oversell the bay.",
    primaryKeyword: "Faire inventory management",
    keywords: ["Faire Shopify inventory sync", "wholesale DTC warehouse", "B2B and DTC same warehouse inventory"],
    features: [
      { title: "ATP on pick start", body: "Insufficient cover returns HTTP 409 — not a negative on-hand." },
      { title: "Channel import", body: "Faire CSV/API ingest lands wholesale orders beside Shopify tickets." },
      { title: "Sellable push", body: "Shopify sees on-hand − held − remaining-to-pick." },
      { title: "Directed pick", body: "Pick map walk stops on the floor plan and 3D racks." },
    ],
    faqs: [
      {
        q: "Does Faire sync inventory itself?",
        a: "Marketplace sync apps move numbers. Rackline makes the physical allocation real so the number means a bay.",
      },
    ],
    related: ["shopify-wms", "apparel", "makers"],
  },
  {
    slug: "apparel",
    path: "/industries/apparel",
    kind: "industry",
    navGroup: "Industries",
    title: "Streetwear & Small-Batch Fashion Warehouse | Rackline WMS",
    description:
      "Size-and-color warehouse for small-batch fashion. Drop waves, ATP, Shopify push, and accurate picks.",
    h1: "Size-and-color warehouse for small-batch fashion",
    lede: "Drops live or die on Medium/Black accuracy. Rackline keeps variants in bays, waves the drop, and pushes sellable qty so Shopify cannot oversell what the rack does not have.",
    primaryKeyword: "streetwear inventory management",
    keywords: ["small batch fashion warehouse", "apparel Shopify WMS", "fashion brand WMS Shopify"],
    features: [
      { title: "Variant locations", body: "Each size/color SKU in a bay — not a spreadsheet matrix." },
      { title: "Drop waves", body: "Release the drop as a wave; batch-pick hot sizes first." },
      { title: "ATP discipline", body: "Pick start reserves; second channel gets 409 instead of a ghost sale." },
      { title: "Returns disposition", body: "RMA restock, scrap, or QC hold." },
    ],
    faqs: [
      {
        q: "Do you plan fabric and cut tickets?",
        a: "Materials can live as component SKUs. Full cut-and-sew PLM stays upstream; we warehouse blanks, trims, and finished goods.",
      },
    ],
    related: ["faire-wholesale", "shopify-wms", "subscription-boxes"],
  },
  // —— Wave E ——
  {
    slug: "3d-printing",
    path: "/industries/3d-printing",
    kind: "industry",
    navGroup: "Industries",
    title: "3D Print Farm Inventory & Fulfillment | Rackline WMS",
    description:
      "Warehouse the finished prints your farm produces. Filament as material, kits as SKUs, Shopify and Etsy ship.",
    h1: "Warehouse the finished prints your farm produces",
    lede: "Farm tools own the printer queue. Rackline owns finished parts, multi-part kits, and the order that leaves the shelf.",
    primaryKeyword: "3D print farm inventory",
    keywords: ["filament inventory warehouse", "print farm fulfillment", "3D printing business inventory software"],
    features: [
      { title: "Material + FG", body: "Filament spools and finished SKUs on one ledger." },
      { title: "Multi-part kits", body: "BOM explode into shippable products." },
      { title: "Shopify / marketplace ship", body: "Pick, pack, label from bays." },
    ],
    faqs: [
      {
        q: "Do you replace SimplyPrint or Printago?",
        a: "No. Keep farm software for printers. Rackline starts when parts hit a bin.",
      },
    ],
    related: ["hardware-electronics", "kit-assembly", "makers"],
  },
  {
    slug: "outdoor-gear",
    path: "/industries/outdoor-gear",
    kind: "industry",
    navGroup: "Industries",
    title: "Outdoor Brand Warehouse Software | Rackline WMS",
    description:
      "Seasonal gear drops, one accurate warehouse. Waves, multi-SKU kits, Shopify, and ATP for outdoor DTC brands.",
    h1: "Seasonal gear drops, one accurate warehouse",
    lede: "Peak season multiplies SKUs and channels. Rackline waves the drop, kits accessories, and keeps Amazon/Shopify from selling empty bays.",
    primaryKeyword: "outdoor brand warehouse software",
    keywords: ["outdoor brand inventory management", "DTC outdoor brand WMS"],
    features: [
      { title: "Seasonal waves", body: "Pre-pick and release by drop date." },
      { title: "Accessory kits", body: "Strap + bottle + patch as one shippable kit." },
      { title: "Multi-channel ready", body: "Shopify today; Faire and marketplaces next." },
    ],
    faqs: [],
    related: ["apparel", "shopify-wms", "kit-assembly"],
  },
  {
    slug: "private-label",
    path: "/use-cases/private-label",
    kind: "use-case",
    navGroup: "Use cases",
    title: "Private Label Inventory & Co-Packer Receive | Rackline WMS",
    description:
      "Private-label founders: receive co-packer lots, FEFO hold, kit, and ship your brand from one warehouse.",
    h1: "Receive co-packer lots. Ship your brand.",
    lede: "Co-man fills the bottles. You still need ASN receive, lot dates, QC holds, and DTC ship. Rackline is the brand warehouse — not the factory MES.",
    primaryKeyword: "private label inventory management",
    keywords: ["co-packer inventory tracking brand", "receive from co-packer warehouse", "brand owner warehouse software"],
    features: [
      { title: "ASN / PO receive", body: "Partial cartons, lots, expiry on inbound." },
      { title: "QC hold", body: "Quarantine a lot until COA clears." },
      { title: "Brand ship", body: "Shopify fulfillment from your bays." },
    ],
    faqs: [],
    related: ["food-beverage", "beauty", "shopify-wms"],
  },
  // —— Compare ——
  {
    slug: "vs-shiphero",
    path: "/compare/vs-shiphero",
    kind: "compare",
    navGroup: "Compare",
    title: "Rackline vs ShipHero | Rackline WMS",
    description:
      "ShipHero is fulfillment-first mid-market WMS. Rackline is maker-first: Garage Mode, kits, floor maps, and Promise without $2k/mo starting ACV.",
    h1: "Rackline vs ShipHero",
    lede: "Choose ShipHero when you are a high-volume DTC or ecommerce 3PL. Choose Rackline when you still manufacture or kit what you sell and need a garage→warehouse path.",
    primaryKeyword: "ShipHero alternative for makers",
    keywords: ["Rackline vs ShipHero", "ShipHero alternative small manufacturer"],
    features: [
      { title: "Price posture", body: "ShipHero historically ~$2k/mo. Rackline targets maker self-serve economics." },
      { title: "Manufacturing", body: "Rackline: BOMs, kits, as-built, work orders. ShipHero: fulfillment-centric." },
      { title: "Floor maps", body: "Rackline ships 2D/3D rack maps as core UX." },
      { title: "Promise", body: "Leave-by from shelf, queue, pace, inbound — ShipHero optimizes throughput differently." },
    ],
    faqs: [],
    related: ["makers", "shopify-wms", "vs-katana"],
  },
  {
    slug: "vs-katana",
    path: "/compare/vs-katana",
    kind: "compare",
    navGroup: "Compare",
    title: "Rackline vs Katana MRP | Rackline WMS",
    description:
      "Katana owns production planning for makers. Rackline owns bin-level WMS, Garage Mode, Promise, and floor maps.",
    h1: "Rackline vs Katana",
    lede: "Katana is strong when scheduling production is the pain. Rackline is strong when the pain is bays, directed pick, FEFO, and a leave-by the floor can hit.",
    primaryKeyword: "Katana vs WMS",
    keywords: ["Katana alternative warehouse", "Katana MRP vs WMS"],
    features: [
      { title: "Planning vs execution", body: "Katana: schedule and MRP. Rackline: warehouse execution + light make." },
      { title: "WMS depth", body: "Katana WMS is an add-on. Rackline WMS is the product." },
      { title: "Garage Mode", body: "Rackline’s growth path is a first-class mode, not a SKU cap alone." },
      { title: "Accounting", body: "Katana + QBO ecosystem is mature; Rackline ships COGS export/sync in Phase 1." },
    ],
    faqs: [],
    related: ["vs-craftybase", "kit-assembly", "makers"],
  },
  {
    slug: "vs-craftybase",
    path: "/compare/vs-craftybase",
    kind: "compare",
    navGroup: "Compare",
    title: "Rackline vs Craftybase | Rackline WMS",
    description:
      "Craftybase owns maker COGS and recipes. Rackline owns warehouse execution — locations, pick/pack/ship, Promise, Shopify fulfillment.",
    h1: "Rackline vs Craftybase",
    lede: "Keep caring about recipe cost. When you need bins, scanners, and a ship wave, you need a WMS — not another costing spreadsheet.",
    primaryKeyword: "Craftybase alternative WMS",
    keywords: ["Craftybase vs warehouse software", "Stocksmith alternative warehouse"],
    features: [
      { title: "COGS vs floor", body: "Craftybase: GAAP COGS. Rackline: location:item ledger and movements." },
      { title: "Channels", body: "Both speak Shopify; Rackline adds directed warehouse flows." },
      { title: "Growth", body: "Craftybase stays inventory/costing. Rackline opens Manufacturer mode on the same ledger." },
    ],
    faqs: [],
    related: ["vs-katana", "makers", "shopify-wms"],
  },
  {
    slug: "vs-fishbowl",
    path: "/compare/vs-fishbowl",
    kind: "compare",
    navGroup: "Compare",
    title: "Rackline vs Fishbowl | Rackline WMS",
    description:
      "Fishbowl is QuickBooks-centric mid-market inventory. Rackline is Cloudflare-native garage-to-warehouse for makers.",
    h1: "Rackline vs Fishbowl",
    lede: "Fishbowl wins teams already deep in QuickBooks Desktop/Online with paid implementation. Rackline wins founders who want self-serve floor ops first.",
    primaryKeyword: "Fishbowl alternative cloud WMS",
    keywords: ["Fishbowl vs Rackline", "modern alternative to Fishbowl"],
    features: [
      { title: "Implementation", body: "Fishbowl often mandates paid onboarding. Rackline: signup → Garage Mode → Northwind demo." },
      { title: "UX", body: "Rackline: modern React floor + 3D map. Fishbowl: classic mid-market." },
      { title: "Manufacturing", body: "Fishbowl Advanced gates deep mfg. Rackline kits/WO ship in Garage." },
    ],
    faqs: [],
    related: ["vs-katana", "garage-warehouse", "makers"],
  },
  {
    slug: "self-fulfill-vs-3pl",
    path: "/compare/self-fulfill-vs-3pl",
    kind: "compare",
    navGroup: "Compare",
    title: "Self-Fulfill Kickstarter vs 3PL | Rackline WMS",
    description:
      "When to self-fulfill a crowdfunding wave with software vs hire a 3PL like Fulfillrite. Rackline is the in-house path.",
    h1: "Self-fulfill your campaign vs hire a 3PL",
    lede: "Hire a 3PL when volume, freight, and staffing exceed your floor. Self-fulfill when kits are complex, margins are thin, or you want leftover DTC inventory under your control.",
    primaryKeyword: "in-house Kickstarter fulfillment",
    keywords: ["Kickstarter 3PL vs self fulfill", "crowdfunding warehouse software"],
    features: [
      { title: "Software path", body: "Import pledges, kit tiers, wave pick, ship, leftover → Shopify." },
      { title: "3PL path", body: "Export to Fulfillrite/Matrix-class partners when the wave is too big." },
      { title: "Hybrid", body: "Run early waves in-house; graduate later without losing SKU discipline." },
    ],
    faqs: [],
    related: ["kickstarter-fulfillment", "board-games", "garage-warehouse"],
  },
];

const bySlug = new Map(MARKETING_PAGES.map((p) => [p.slug, p]));
const byPath = new Map(MARKETING_PAGES.map((p) => [p.path, p]));

export function marketingPageBySlug(slug: string): MarketingPage | undefined {
  return bySlug.get(slug);
}

export function marketingPageByPath(path: string): MarketingPage | undefined {
  const bare = path.split("?")[0]?.replace(/\/$/, "") || "/";
  return byPath.get(bare);
}

export function marketingNavGroups(): { label: string; items: { name: string; path: string }[] }[] {
  const order = ["Industries", "Use cases", "Compare"] as const;
  return order.map((label) => ({
    label,
    items: MARKETING_PAGES.filter((p) => p.navGroup === label).map((p) => ({
      name: p.h1.length > 48 ? p.title.replace(/\s*\|\s*Rackline WMS$/, "") : p.h1,
      path: p.path,
    })),
  }));
}

export function relatedPages(page: MarketingPage): MarketingPage[] {
  return page.related.map((slug) => bySlug.get(slug)).filter((p): p is MarketingPage => Boolean(p));
}

export function sitemapPaths(): string[] {
  return ["/", ...MARKETING_PAGES.map((p) => p.path)];
}
