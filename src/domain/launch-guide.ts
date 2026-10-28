/** Shared onboarding guidance. Availability describes a capability, never a live launch approval. */
import type { OnboardingStepId } from "./onboarding";

export type LaunchProfile = "core" | "manufacturing" | "fulfillment";
export type RequirementTier = "essential" | "conditional" | "advanced";

export type SetupRequirement = {
  id: string;
  title: string;
  tier: RequirementTier;
  when: string;
  why: string;
  path: string;
  actionLabel: string;
  signal?: OnboardingStepId;
  walkthroughId: string;
  requiredFor?: readonly LaunchProfile[];
};

export type LaunchWalkthrough = {
  id: string;
  title: string;
  summary: string;
  steps: readonly { title: string; body: string; path?: string; actionLabel?: string }[];
};

export type FulfillmentLaunchCheck = {
  id: string;
  title: string;
  scope: "software" | "operations" | "commercial";
  support: "available" | "partial" | "external";
  requirement: string;
  verify: string;
  path?: string;
  limitation?: string;
};

/** Conditional work becomes essential only for the selected operating plan. No setting is changed. */
export function requirementTier(item: SetupRequirement, profile: LaunchProfile): RequirementTier {
  return item.tier === "conditional" && item.requiredFor?.includes(profile) ? "essential" : item.tier;
}

export type LaunchCapacityInput = {
  minimumOrders: number;
  maximumOrders: number;
  operatingDays: number;
  /** A measured pilot rate, not a Rackline-provided productivity assumption. */
  ordersPerPersonPerDay: number | null;
};

/** A planning calculation only. Working days and measured output must come from the business. */
export function estimateLaunchCapacity(input: LaunchCapacityInput): {
  dailyMinimum: number;
  dailyMaximum: number;
  peopleMinimum: number | null;
  peopleMaximum: number | null;
} {
  if (!Number.isSafeInteger(input.minimumOrders) || input.minimumOrders <= 0) {
    throw new Error("Enter a positive minimum order count using whole orders within the supported range.");
  }
  if (!Number.isSafeInteger(input.maximumOrders) || input.maximumOrders <= 0) {
    throw new Error("Enter a positive maximum order count using whole orders within the supported range.");
  }
  if (input.minimumOrders > input.maximumOrders) {
    throw new Error("The maximum order count must be at least the minimum.");
  }
  if (!Number.isSafeInteger(input.operatingDays) || input.operatingDays < 1) {
    throw new Error("Enter at least one whole operating day.");
  }
  const rate = input.ordersPerPersonPerDay;
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    throw new Error("Enter a positive measured orders-per-person rate, or leave it blank.");
  }
  const minimum = input.minimumOrders / input.operatingDays;
  const maximum = input.maximumOrders / input.operatingDays;
  const peopleMinimum = rate === null ? null : Math.ceil(minimum / rate);
  const peopleMaximum = rate === null ? null : Math.ceil(maximum / rate);
  if (peopleMinimum !== null && (!Number.isFinite(peopleMinimum) || !Number.isFinite(peopleMaximum))) {
    throw new Error("The order count and measured rate produce an impractical staffing estimate. Check both inputs.");
  }
  return {
    dailyMinimum: Math.ceil(minimum),
    dailyMaximum: Math.ceil(maximum),
    peopleMinimum,
    peopleMaximum,
  };
}

export const SETUP_REQUIREMENTS: readonly SetupRequirement[] = [
  { id: "building", title: "Name your building", tier: "essential", when: "Every business; start with one building.", why: "A real building name and time zone keep stock, jobs, and carrier cutoffs tied to the right place.", path: "/setup/warehouse", actionLabel: "Building settings", walkthroughId: "building" },
  { id: "locations", title: "Create the places stock passes through", tier: "essential", when: "Every business; a dock, storage place, and shipping area are a useful starting layout.", why: "Rackline tracks quantities on a SKU in a location. Racks are optional: a shelf, floor bay, or bench can be a location.", path: "/welcome", actionLabel: "Set up your floor", signal: "bays", walkthroughId: "building" },
  { id: "labels", title: "Choose names and verify your bay labels", tier: "essential", when: "Before people receive or move real stock.", why: "Let Rackline generate addresses, or customize supported aisle and area names within Rackline's address format. Print and scan the labels so a screen address matches a physical place.", path: "/setup/labels", actionLabel: "Print bay labels", walkthroughId: "building" },
  { id: "catalog", title: "Add the SKUs you stock or sell", tier: "essential", when: "Every business; begin with one real item or clearly marked practice data.", why: "Use a stable SKU and barcode per item. Enable serial, lot, expiry, or weight tracking only when the product needs it.", path: "/stock/items", actionLabel: "Open catalog", signal: "sku", walkthroughId: "catalog" },
  { id: "stock", title: "Receive opening stock", tier: "essential", when: "Before promising stock to an order.", why: "Post a receipt into its actual location, then put it away. Creating an item alone does not create on-hand inventory.", path: "/inbound/receipts", actionLabel: "Receive stock", signal: "stock", walkthroughId: "receive" },
  { id: "practice", title: "Complete a practice order", tier: "essential", when: "Before starting the working day with real customers.", why: "Walk the full receive, putaway, pick, pack, and ship process, then reconcile quantities and tracking. A completed checklist is not a capacity test.", path: "/outbound/orders", actionLabel: "Open orders", signal: "shipped", walkthroughId: "pick-pack-ship" },
  { id: "team", title: "Add people and assign work", tier: "conditional", when: "When anyone else works in the building; a solo owner can begin alone.", why: "Each person needs their own login, role, and allowed floor tasks so assignments and activity identify the actual operator.", path: "/setup/team", actionLabel: "Set up your team", signal: "teammate", walkthroughId: "team", requiredFor: ["fulfillment"] },
  { id: "store", title: "Connect the order channel", tier: "conditional", when: "When orders should arrive automatically; manual orders can start without a connection.", why: "Connect Shopify or another supported channel, map SKUs, and verify a test order before relying on automatic imports.", path: "/setup/integrations", actionLabel: "Connect a channel", signal: "store", walkthroughId: "shopify", requiredFor: ["fulfillment"] },
  { id: "postage", title: "Connect a real carrier and printer", tier: "conditional", when: "When Rackline will buy postage or print production shipping labels.", why: "Use the intended account, correct ship-from address, parcel dimensions, and a tested printer. Rackline Ground and demo labels are not paid postage.", path: "/setup/carriers", actionLabel: "Set up carriers", signal: "carrier", walkthroughId: "serial-multibox", requiredFor: ["fulfillment"] },
  { id: "serials", title: "Verify serials and every shipping carton", tier: "conditional", when: "When the customer needs unit-level traceability or an order ships in multiple boxes.", why: "Scan each product serial at pack, inspect each serial's order association in Returns lookup, and check every carton. Missing serials are not fully blocked; a complete serial-by-order report still needs reporting or integration work.", path: "/floor/pack", actionLabel: "Open pack station", walkthroughId: "serial-multibox", requiredFor: ["fulfillment"] },
  { id: "returns", title: "Agree the returns inspection process", tier: "conditional", when: "Before accepting customer returns.", why: "Define inspection, photo evidence, and restock, hold, or scrap rules. Desktop return details capture photos and condition; a floor receipt alone does not enforce that process.", path: "/outbound/returns", actionLabel: "Open returns", walkthroughId: "returns", requiredFor: ["fulfillment"] },
  { id: "clients", title: "Set up the fulfillment client and access", tier: "conditional", when: "When holding or fulfilling stock for another business.", why: "Tag that client's stock and orders and test its read-only portal. Organization-wide API keys must not be handed out as if they isolate one client's data.", path: "/setup/clients", actionLabel: "Open client setup", walkthroughId: "clients", requiredFor: ["fulfillment"] },
  { id: "recipes", title: "Define the recipe and production place", tier: "conditional", when: "When you assemble or manufacture finished goods.", why: "A BOM lists component quantities. A kit or work order consumes those components and posts finished stock into an output location.", path: "/make/recipes", actionLabel: "Open recipes", walkthroughId: "manufacturing", requiredFor: ["manufacturing"] },
  { id: "launch-plan", title: "Confirm the operating and launch plan", tier: "conditional", when: "Before a customer launch, a large backlog, or a service commitment.", why: "Agree unloading, staffing, cutoff times, returns rules, insurance, account billing, and acceptance tests. App setup alone does not prove those commitments.", path: "/today", actionLabel: "Open the work board", walkthroughId: "go-live", requiredFor: ["fulfillment"] },
  { id: "more-buildings", title: "Additional buildings", tier: "advanced", when: "Add them when stock is physically held in another facility.", why: "Each building gets its own layout and jobs. All bay barcodes must remain unique across the organization; use the suggested next free aisle or distinct supported aisle names.", path: "/setup/warehouse", actionLabel: "Manage buildings", walkthroughId: "building" },
  { id: "slotting", title: "Pick faces, bulk bays, and replenishment", tier: "advanced", when: "Useful when fast movers need frequent refills.", why: "Keep a convenient picking quantity near the work and refill it from bulk stock. It is not necessary to maintain a correct stock ledger.", path: "/stock/replenish", actionLabel: "Explore replenishment", walkthroughId: "power-tools" },
  { id: "waves", title: "Zones and wave or batch picking", tier: "advanced", when: "Useful when several orders share a route, cutoff, or client.", why: "Group work to reduce repeated walks after the basic single-order process is reliable.", path: "/outbound/waves", actionLabel: "Explore waves", walkthroughId: "power-tools" },
  { id: "controls", title: "Counts, holds, and quality controls", tier: "advanced", when: "Add a schedule as inventory grows; product or customer rules can make controls mandatory.", why: "Counts detect differences and holds protect stock from being picked. Turn operational requirements into a written routine, not an assumed software guarantee.", path: "/stock/counts", actionLabel: "Plan counts", walkthroughId: "power-tools" },
  { id: "analytics", title: "Performance, automation, and integrations", tier: "advanced", when: "After you have a trustworthy working process and enough real activity.", why: "Use labor reporting and automation to improve a measured process. Connect APIs only with the access scope and ownership your business needs.", path: "/setup/integrations", actionLabel: "Explore integrations", walkthroughId: "power-tools" },
];

export const WALKTHROUGHS: readonly LaunchWalkthrough[] = [
  {
    id: "team", title: "Build your team and assign the first job", summary: "Give every operator a clear identity, permissions, and a place to find their work.",
    steps: [
      { title: "Plan roles before inviting", body: "Use a laptop or desktop for setup. Keep owner access for the people who manage settings; give floor operators the tasks they actually perform. A shared login hides who posted stock changes.", path: "/setup/team", actionLabel: "Open team" },
      { title: "Add each person", body: "Create a named teammate and choose their role and floor tasks. Email invitations need configured mail; when mail is unavailable, use the supported starter-password flow and have the person change it. Adding an account does not prove the person has signed in." },
      { title: "Make one real assignment", body: "Open a receipt, order, or work order and assign its job to the intended person. Unassigned work remains available; do not assign the same work under a shared account.", path: "/today", actionLabel: "Find open work" },
      { title: "Verify the operator's view", body: "Have the operator sign in on their work device, open My jobs, claim or start the task, and finish a practice post. Check that the office sees the right person and result.", path: "/floor#mine", actionLabel: "Open My jobs" },
    ],
  },
  {
    id: "building", title: "Set up buildings, racks, bays, and labels", summary: "Create a floor that people can recognize and scan without memorizing a screen.",
    steps: [
      { title: "Start on a laptop or desktop", body: "The larger screen is best for building setup, map placement, catalog imports, and team administration. Tablets and phones are useful for daily scanning once the setup is checked. You can still review the plan on a smaller device.", path: "/welcome", actionLabel: "Open building wizard" },
      { title: "Name the building and set its time zone", body: "Start with one real facility. Confirm the building dimensions, time zone, north direction, and ship-from address in Warehouse settings. Add more buildings only where stock is physically held.", path: "/setup/warehouse", actionLabel: "Open warehouse settings" },
      { title: "Lay out the flow", body: "Identify where stock arrives, where it is stored, an assembly bench if needed, and where packed orders leave. Keep receiving and outbound staging distinguishable. Plan real working clearances with your site lead." },
      { title: "Let Rackline create addresses", body: "The wizard and Build floor create bay codes and matching barcodes as racks are added. A-01-01 means aisle A, rack 01, bay 01 at level 1; A-01-01-2 is level 2. Number from a consistent starting end of the aisle. A floor storage place works too; a rack is not required for every item.", path: "/map", actionLabel: "Open the floor map" },
      { title: "Adapt the supported names to your business", body: "Customize aisle and area names within Rackline's address format; arbitrary address templates are not supported. Keep place IDs stable and independent of the SKU stored there, with zero-padded rack and bay numbers. Addresses must be unique across buildings: choose the suggested next free aisle or a distinct 1–3 letter aisle such as TA or TB, not a hyphenated building prefix. Preview labels before creating a large layout." },
      { title: "Print, place, and scan", body: "Print the generated bay labels, affix each to its actual place, and walk the route with an operator. Scan a dock, a storage bay, and the shipping area and confirm the record matches the place before receiving real stock.", path: "/setup/labels", actionLabel: "Open labels" },
    ],
  },
  {
    id: "catalog", title: "Create a useful catalog", summary: "Keep item identity stable and add tracking rules only where the product needs them.",
    steps: [
      { title: "Start with one SKU", body: "Use a stable item code and a clear name. Record the barcode printed on the product or generate a label. Keep your location address separate from your SKU.", path: "/stock/items", actionLabel: "Open items" },
      { title: "Choose the tracking rules", body: "Turn on serial tracking for individually identified products, lot and expiry tracking where required, and catch-weight tracking when weight matters. Confirm these rules before the first stock receipt; extra fields create real work at receive and pick." },
      { title: "Check shipping information", body: "For shipping, confirm product weights, packaging, origin and customs data where needed. Test one representative product and box before importing the rest of the catalog.", path: "/setup/imports", actionLabel: "Open imports" },
      { title: "Separate practice from production", body: "Practice with the shared demo or clearly marked sample items. Sample data teaches the flow; it is not proof that your own catalog, inventory, store, or carrier connection is ready." },
    ],
  },
  {
    id: "receive", title: "Receive and put away the first stock", summary: "Turn an arrival into reliable quantities at a known physical place.",
    steps: [
      { title: "Create the expected arrival", body: "Use a receipt or purchase order for a simple arrival; use an ASN when you need an advance shipment and vendor carton detail. Add a container reference when applicable. Plan the unloading crew, equipment, and staging space separately.", path: "/inbound/receipts", actionLabel: "Open receipts" },
      { title: "Count what actually arrived", body: "Scan the receiving bay and item, record actual quantities and required lots or serials, and post only what was received. A partial receipt is normal; investigate discrepancies before posting the remainder.", path: "/floor/receive", actionLabel: "Open receive" },
      { title: "Move it into a real storage place", body: "Scan the source, item or carton, and destination bay. Follow the suggested putaway bay when it fits the product and physical space. A successful receipt does not mean the stock has already been put on the shelf.", path: "/floor/putaway", actionLabel: "Open putaway" },
      { title: "Reconcile the result", body: "Look up the bay and item. Confirm dock and storage quantities match what the operator can count, and review the ledger entry if they differ.", path: "/stock", actionLabel: "Check inventory" },
    ],
  },
  {
    id: "pick-pack-ship", title: "Walk an order from promise to shipment", summary: "Prove the essential flow with a controlled practice order before the first busy day.",
    steps: [
      { title: "Choose the right workflow", body: "Garage Mode offers the Ship queue for a small team. Manufacturer mode uses separate scan-driven pick, pack, and ship steps and a larger set of warehouse tools. The mode changes workflow rules; choose it deliberately in Warehouse settings.", path: "/setup/warehouse", actionLabel: "Review your workflow" },
      { title: "Create and pick a practice order", body: "Use a clearly identified practice order with known stock. In the full warehouse flow, start pick, scan the bay and product, and confirm the actual quantity. Starting pick reserves available stock; an imported order alone is not a reservation.", path: "/outbound/orders", actionLabel: "Open orders" },
      { title: "Pack and check", body: "Confirm the right product and quantity in the box. For serialized goods, scan each serial and inspect that serial's order association in Returns lookup. Missing serials are not fully blocked, and the current UI does not provide a complete serial-by-order manifest. Set carton weight and dimensions before quoting a label.", path: "/floor/pack", actionLabel: "Open pack" },
      { title: "Verify the label without accidental purchases", body: "Use demo labels to practice. They are not real postage. A live label purchase spends money and must be a separate deliberate action on the intended carrier account; onboarding does not buy labels for you.", path: "/setup/carriers", actionLabel: "Review carriers" },
      { title: "Reconcile after ship", body: "Check the final stock balance, each carton and tracking number, operator activity, and any store fulfillment update. A software practice run is separate from proving that your staff can sustain the required throughput.", path: "/stock/ledger", actionLabel: "Review the ledger" },
    ],
  },
  {
    id: "shopify", title: "Connect Shopify and test the round trip", summary: "Validate imported orders, inventory, and every carton with a controlled store test.",
    steps: [
      { title: "Connect the intended store", body: "An owner connects Shopify with the supported app flow or Admin token. Confirm store, permissions, warehouse, and inventory location before enabling live use. Demo mode records requests without contacting Shopify.", path: "/setup/shopify", actionLabel: "Open Shopify setup" },
      { title: "Match products and inventory", body: "Match SKUs and Shopify inventory items, choose the stock location, and compare Rackline's sellable quantity with the store. Sellable stock differs from raw on-hand stock when held or committed quantities exist." },
      { title: "Send a controlled order", body: "Confirm an order arrives once, correct the address and item mapping if needed, and try the normal cancellation path. Record the result before inviting the whole team to rely on the integration.", path: "/outbound/orders", actionLabel: "Inspect the imported order" },
      { title: "Test more than one carton", body: "Pack one order into two cartons and check that each shipped carton sends its own tracking and fulfillment quantities back to Shopify. Verify both boxes in Shopify; one order-level tracking summary is not a substitute.", path: "/floor/ship", actionLabel: "Open shipping" },
    ],
  },
  {
    id: "serial-multibox", title: "Verify serials, carrier billing, and multiple boxes", summary: "Use actual product labels and the intended carrier account in an accepted launch rehearsal.",
    steps: [
      { title: "Prepare the serialized item", body: "Enable serial tracking on the SKU and verify the carton barcode resolves to the product's serial. Agree the customer's serial format and who fixes an unreadable label.", path: "/stock/items", actionLabel: "Review item tracking" },
      { title: "Scan each unit at pack", body: "Open the intended order and scan each serial into its pack. Check the quantity, duplicate handling, and order association. The app records serials when supplied, but does not fully prevent a serialized line from being packed with no serials; use an explicit release check.", path: "/floor/pack", actionLabel: "Open pack" },
      { title: "Check an individual serial against its order", body: "On Returns, use Find a return: enter one known serial, choose Look up, and confirm the matched order. An order search shows only the first match, not all serials. The authenticated lookup API returns matches, but a complete serial-by-order manifest and customer access still need a report or integration. Check carton and tracking details separately on the order; Floor Lookup is not a full serial manifest.", path: "/outbound/returns", actionLabel: "Open return lookup" },
      { title: "Confirm the actual billing account", body: "Configure the customer's own FedEx or other carrier account when agreed. Confirm ship-from and ship-to addresses, parcel dimensions, enabled services, and printer output. Comparing rates is useful; a no-markup promise is a commercial agreement that the app cannot certify.", path: "/setup/carriers", actionLabel: "Review carrier accounts" },
      { title: "Rehearse two boxes", body: "Give each carton its own label and tracking, verify store updates for both, and reconcile the carrier charge to the agreed account. Demo output is not paid postage. Purchase or void a live label only as a deliberate authorized test; the walkthrough never purchases automatically." },
    ],
  },
  {
    id: "returns", title: "Receive, inspect, and document a return", summary: "Make the evidence and disposition rules clear before a returned unit re-enters sellable stock.",
    steps: [
      { title: "Agree the customer's rules", body: "Write down what condition can be restocked, what must be held for review, what is scrapped, and who approves an exception. Set a distinct inspection or quarantine place when that helps prevent accidental resale." },
      { title: "Open the return and identify it", body: "Find or create the RMA, match the order and serial where available, and record the actual returned quantity. Keep unmatched or uncertain units separate while they are checked.", path: "/outbound/returns", actionLabel: "Open returns" },
      { title: "Inspect and photograph on the return record", body: "Use the desktop return detail to add condition, grade, and photos. Photo storage needs the configured media bucket. These entries are optional in the software today; your process must check that the required evidence exists before release. The floor receive screen alone does not capture the complete inspection.", path: "/outbound/returns", actionLabel: "Record inspection evidence" },
      { title: "Post the right disposition", body: "Restock approved goods, hold uncertain stock, or scrap rejected units according to the agreed rules. Confirm the destination and the resulting balance. A return receipt is not by itself an inspection approval." },
      { title: "Close the loop", body: "Check the photos, notes, serial association, and posted stock result with a supervisor, then confirm what the customer will receive as evidence." },
    ],
  },
  {
    id: "clients", title: "Give a fulfillment client the right visibility", summary: "Keep client ownership, stock reporting, and access boundaries clear.",
    steps: [
      { title: "Create the client", body: "Use the full warehouse workflow for client fulfillment. Add the client and consistently tag its receipts, stock activity, and orders. Merely creating a client does not move or assign existing inventory.", path: "/setup/clients", actionLabel: "Open clients" },
      { title: "Check the client portal", body: "Enable and securely share the client's read-only portal link. Compare its stock with client-tagged inventory and confirm another client's records are not visible. Portal shipment views summarize at order level; they are not the complete per-carton or serial report." },
      { title: "Scope API access deliberately", body: "The read API is available for orders, on-hand stock, and shipment summaries. Existing API keys are organization-scoped, not client-isolated, and the stock response is not sellable ATP. Do not give a partner a whole-organization key expecting it to isolate one client's stock.", path: "/setup/integrations", actionLabel: "Review API access" },
    ],
  },
  {
    id: "manufacturing", title: "Turn components into finished stock", summary: "Add production only when your business actually makes or assembles goods.",
    steps: [
      { title: "Add components and finished goods", body: "Create the stock items and identify the component source and finished-goods output location. The building wizard can add a production bench; omit it if your business only stores and ships." },
      { title: "Define a small recipe", body: "Create a BOM with the exact component quantity per finished unit. Start with a simple known build and verify units before scaling the recipe.", path: "/make/recipes", actionLabel: "Open recipes" },
      { title: "Complete a controlled build", body: "Receive the components, open a kit or work order, assign the operator, and complete only the quantity actually made. Check that components were consumed and finished stock appeared in the output place.", path: "/make/work-orders", actionLabel: "Open work orders" },
      { title: "Add production detail later", body: "Instructions, photos, genealogy, scheduling, and labor analysis become more valuable after the basic recipe and stock movements are correct." },
    ],
  },
  {
    id: "go-live", title: "Rehearse the launch and agree who owns it", summary: "Separate configured software from a measured operating plan and signed service commitments.",
    steps: [
      { title: "Write the volume and deadline", body: "Record the backlog, expected orders and units, boxes per order, deadline, and actual operating days. Divide orders by those days to set a planning target. A two-week calendar window does not automatically mean ten working days." },
      { title: "Plan the physical arrival", body: "For loose-loaded containers, agree appointment, access, unloading labor and equipment, staging capacity, count method, damage evidence, and the route from dock to storage. Confirm this with the building operator.", path: "/inbound/asns", actionLabel: "Plan an arrival" },
      { title: "Measure a representative shift", body: "Time receiving, putaway, picking, serial pack, printing, carrier handoff, and rework. Use your measured rates and staffing hours to test the daily target; include breaks, exceptions, and multiple-box orders. Job counts and a completed wizard do not prove throughput.", path: "/today", actionLabel: "Open the work board" },
      { title: "Agree the business obligations", body: "Confirm insurance limits and exclusions for inventory in each building, carrier-account billing and any markup, included software/scanners/infrastructure, return charges, escalation contacts, and the overall service rates. Keep signed agreements outside the setup checklist." },
      { title: "Run the customer acceptance test", body: "Record evidence for a real store order, every carton's tracking, individual serial-to-order matches, inventory visibility, and a photographed return. List the complete serial-by-order manifest and customer access as unresolved until a suitable report or integration is validated. Confirm the customer accepts the results. Live postage purchases remain explicit actions." },
      { title: "Choose the launch owner", body: "Name the person who can release the operation, the fallback contact, and what stops a shipment. Review gaps and dates with that owner; this walkthrough does not certify readiness or publish an SLA." },
    ],
  },
  {
    id: "power-tools", title: "Add power tools after the basic flow works", summary: "Use measured needs to choose the next layer of warehouse control.",
    steps: [
      { title: "Reduce unnecessary walking", body: "Use zones and wave or batch picking when multiple orders share routes or cutoffs. Keep fast movers in convenient pick faces and replenish from bulk when it reduces work.", path: "/outbound/waves", actionLabel: "Explore waves" },
      { title: "Protect inventory quality", body: "Schedule blind counts, hold questionable stock, and use lot, expiry, and serial rules when needed. The product or customer may make a control essential even though it is not part of every business's basic setup.", path: "/stock/counts", actionLabel: "Explore counts" },
      { title: "Improve a measured process", body: "Review actual exceptions and labor activity before adding more automation or integrations. Add equipment custody, extra buildings, client billing, and API connections when they solve a specific operational need.", path: "/setup/integrations", actionLabel: "Explore integrations" },
    ],
  },
];

export const FULFILLMENT_LAUNCH_CHECKS: readonly FulfillmentLaunchCheck[] = [
  { id: "container", title: "Container receiving and putaway", scope: "operations", support: "partial", requirement: "Receive a loose-loaded container, count its contents, stage it, and put stock into known bays.", verify: "Rehearse an arrival with the building team; verify unloading labor, equipment, staging space, damage recording, partial receipts, and putaway counts.", path: "/inbound/asns", limitation: "ASNs can hold a container reference and support receipts, but software does not prove that a building can unload a 40-foot container or meet a receiving deadline." },
  { id: "shopify", title: "Automatic Shopify order flow", scope: "software", support: "available", requirement: "Orders arrive automatically and each shipped carton sends tracking and fulfillment quantities back to Shopify.", verify: "Use the actual authorized store, match SKUs and inventory location, and verify a controlled two-carton order plus duplicate and cancellation handling.", path: "/setup/shopify", limitation: "Demo records payloads only. A connection or test account is not evidence that a real store's permissions and shipment updates work." },
  { id: "visibility", title: "Client inventory and shipment visibility", scope: "software", support: "partial", requirement: "The client can see its inventory and agreed shipment information through a portal or API.", verify: "Compare client-tagged quantities against the client's portal and explicitly agree the report fields and access boundary.", path: "/setup/clients", limitation: "The portal is client-scoped. Read API keys are organization-scoped, stock is on-hand rather than sellable ATP, and shipment summaries are order-level rather than complete per-carton or serial reports." },
  { id: "serial", title: "Every product serial tied to its order", scope: "software", support: "partial", requirement: "Scan each product's carton serial at pack-out, retain its order association, and retrieve it by order.", verify: "Pack serialized units and test a duplicate and an omitted serial. In Returns, enter a known serial in Find a return, choose Look up, and inspect its order match. Agree and validate a complete order manifest and customer access through a report or integration.", path: "/outbound/returns", limitation: "Serial assignments exist, but an empty serial list is not fully blocked. Returns lookup displays only the first match; the authenticated lookup API returns matches, but the UI has no full serial-by-order manifest. The client portal and read order API do not expose that report. Completeness enforcement, the full report, and customer access need further work." },
  { id: "staffing", title: "Staffing and backlog dispatch plan", scope: "operations", support: "external", requirement: "Assign trained staff and write a credible plan for the initial backlog and ongoing peak orders.", verify: "Set actual working days, order and unit counts, boxes per order, shifts and staffing. Run a timed representative pilot and compare measured output with the target, including exceptions.", path: "/setup/team", limitation: "Named users, job assignment, and labor reporting support execution. They do not supply a staffing plan, certify throughput, or guarantee a two-week dispatch window." },
  { id: "returns", title: "Inspect and photograph every return", scope: "software", support: "partial", requirement: "Receive each return, record inspection and photos, and restock or scrap according to the customer's rules.", verify: "Use desktop return details to attach photos and condition, then verify restock, hold, and scrap outcomes in a controlled return.", path: "/outbound/returns", limitation: "Photos, condition, and disposition are supported but photos and inspection evidence are optional today. The floor receive screen alone does not capture the full inspection; a written process and release check are needed." },
  { id: "fedex", title: "Intended FedEx account and multiple boxes", scope: "software", support: "partial", requirement: "Use the agreed carrier account, print a label for each carton, and record tracking for orders that ship in two or more boxes.", verify: "Confirm account ownership and billing, test printer output and the actual two-box workflow, verify both tracking updates, and reconcile the carrier charge. A live purchase is always a separate deliberate action.", path: "/setup/carriers", limitation: "Own-account live FedEx labels and per-carton shipping exist. There is no built-in per-client account-selection policy or proof of a no-markup agreement. Demo labels are not postage." },
  { id: "rates", title: "Rates and included services", scope: "commercial", support: "external", requirement: "Agree postage markup, alternative carrier rates, fulfillment charges, and whether software, scanners, infrastructure, and integrations are included.", verify: "Document the accepted account and rate comparison and have both parties approve a complete service schedule.", limitation: "App settings do not establish the commercial agreement or confirm that costs are included." },
  { id: "insurance", title: "Inventory insurance at every building", scope: "commercial", support: "external", requirement: "Confirm agreed insurance coverage for the client's inventory while it is in each facility.", verify: "Obtain the policy evidence and agree limits, exclusions, locations, claims handling, and responsibility with the appropriate business parties.", limitation: "Rackline has no insurance verification workflow. Creating a building or finishing onboarding does not establish coverage." },
];
