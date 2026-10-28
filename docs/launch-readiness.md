# Set up Rackline and prove the working process

Do the first setup on a laptop or desktop. A larger screen is useful for the building layout, catalog imports, team permissions, shipping settings, and reviewing several records together. After setup, use the floor workspace on a tablet or phone for scanning and daily work. A small screen can review the plan; it is not the recommended place to build a large warehouse layout.

The quick wizard introduces the places stock passes through and generates initial bay addresses. The launch guide then shows the essential setup, conditional requirements for your business, reusable walkthroughs, and a fulfillment acceptance checklist. A selected launch profile is guidance: it does not change the organization's operating mode, grant permissions, or connect live services.

## Essential versus useful later

“Essential” means the minimum working process. “Conditional” means required when you use that workflow or accept that customer obligation. “Power tool” means useful as the operation grows; a product, customer, or site rule can still make a particular control mandatory for your business.

| Setup | Basic inventory and shipping | Manufacturing | Fulfillment partner | Why it matters |
|---|---|---|---|---|
| Building name and time zone | Essential | Essential | Essential | Quantities, work, and carrier cutoffs belong to a real place. |
| Receiving, storage, and outbound places | Essential | Essential | Essential | A quantity is held on a SKU in a location. A floor bay or shelf can work without modeled racks. |
| Stable naming and verified bay labels | Essential | Essential | Essential | Operators must match a screen address to the physical place. |
| SKU catalog and relevant tracking rules | Essential | Essential | Essential | A SKU identifies a product; locations identify where it is. |
| Opening receipt and putaway | Essential | Essential | Essential | Creating a catalog item does not create stock. |
| Controlled receive-to-ship practice | Essential | Essential | Essential | Confirm quantities and records before relying on the flow. |
| Named staff, roles, and work assignment | When others do the work | When others do the work | Required for the staffing plan | A solo owner can begin alone; shared logins hide who posted a movement. |
| Live order channel | When automatic imports are needed | When automatic imports are needed | Required for the connected-store launch | Manual orders are valid for a basic setup. |
| Live carrier account and tested printer | When buying postage in Rackline | When buying postage in Rackline | Required for the carrier-label launch | Demo labels and Rackline Ground are not paid postage. |
| Serial traceability and carton checks | When products/customer require it | When products/customer require it | Required for the serialized, multi-box launch | Record every unit and every carton; verify the saved associations. |
| Return inspection, photos, and disposition SOP | Before accepting returns | Before accepting returns | Required for the agreed returns service | Evidence must be checked before a unit is released into sellable stock. |
| Client ownership tags and access | When working for another business | When working for another business | Required | A client portal is different from a whole-organization API key. |
| Production bench, BOM, and practice build | When making products | Required | When assembly is part of the service | Components are consumed and finished stock is posted by the build. |
| Physical arrival, staffing, insurance, and commercial sign-off | Before accepting the obligation | Before accepting the obligation | Required for launch acceptance | A configured app does not establish operational or contractual readiness. |
| Additional buildings | When stock is held elsewhere | When stock is held elsewhere | When stock is held elsewhere | Start with one correct facility; every building needs a verified layout. |
| Zones, waves, and batch picking | Power tool | Power tool | Power tool | Reduce repeated walks after the single-order flow works. |
| Pick faces and replenishment | Power tool | Power tool | Power tool | Keep convenient picking quantities near the work when useful. |
| Counts, holds, lots, expiry, and capacity controls | Based on stock and risk | Based on stock and risk | Based on stock and customer rules | Not every item needs every overlay. Do not omit a required product control because it is outside the basic checklist. |
| Labor reporting, automation, equipment, and further integrations | Power tool | Power tool | Power tool | Improve a measured process rather than adding settings for their own sake. |

Progress signals show observed records, not acceptance evidence. A shipped order count does not prove that the order had all required serials, real postage, correct store updates, or a complete customer sign-off. Likewise, a connected store may be in demo mode and a teammate account may not yet have been used by its intended operator.

## A practical setup sequence

### 1. Decide who owns the work

At Settings → Team, give each person a named login. Keep owner access for administrators and give operators their actual floor tasks. Email invitations require configured mail; the supported starter-password flow is available when mail is unavailable. Have each person sign in and change a starter password.

Create or open a receipt, order, or work order, assign its job to the intended person, and confirm that it appears in that person's floor My jobs list. Unassigned work remains available to claim. Verify an actual practice result in the office, not just the existence of an account.

### 2. Define the building and flow

Use the building wizard at `/welcome` and Warehouse settings at `/setup/warehouse`. Confirm dimensions, time zone, direction, and ship-from address. Identify receiving/staging, storage, an assembly place if needed, and outbound staging. The map helps model places; your site lead must validate working clearances, equipment access, safe use, and applicable physical requirements.

Add additional facilities only when inventory is physically held there. Confirm the selected building before adding locations or receiving stock.

### 3. Let Rackline name the bays, or adapt the supported names

The wizard and Build floor create bay codes, human-readable names, and matching barcodes as racks are added. The standard hierarchy is aisle → rack → bay → level:

| Example | Meaning |
|---|---|
| `A-01-01` | Aisle A, rack 01, bay 01, level 1 |
| `A-01-01-2` | The same bay, level 2 |
| `DOCK` | A separately identified receiving place |
| `SHIP` | A separately identified outbound place |

Use short, stable place IDs. Keep SKU names out of the bay address: contents change, the place stays. Number consistently from the same end of the aisle, zero-pad numeric parts, and use a convention that a new operator can follow without a map open.

Bay codes and barcodes are unique across the organization, including other buildings. The wizard suggests the next free aisle and receiving/shipping codes. You can customize supported aisle and area names within Rackline's address format; arbitrary address templates are not supported. Aisles use 1–3 letters: distinct aisle names such as `TA` and `TB` can identify different buildings without inserting a hyphenated building prefix. Preview generated addresses before creating many racks. Do not assume the same `A-01-01` barcode can be reused in a second building.

Print and affix labels before loading real stock. Have an operator walk and scan a dock, rack bay, upper level, and shipping place. Confirm both the screen record and the physical position.

### 4. Add products and opening stock

Create a stable SKU and barcode per product. Enable serial, lot, expiry, or weight tracking where the product requires it. Confirm shipping weights, boxes, and customs data where needed. Test one representative product before importing a large catalog.

Post a receipt for actual stock at the actual receiving place. Count what arrived; partial receipts are valid. Record required serials/lots and investigate differences. Put stock away into its storage location and reconcile both the dock and destination balances.

Use the demo organization or clearly marked practice items for learning. Demo data is separate from proving your real inventory and connections.

### 5. Complete a controlled order

Garage Mode uses the smaller Ship queue workflow. Manufacturer mode uses separate scan-driven pick, pack, and ship steps, plus the wider warehouse toolset. Switching modes changes workflow rules and must be deliberate; choosing a launch-guide profile alone does not switch modes.

Create a controlled order, start pick, scan the bay and product, confirm the picked quantity, pack it, and check its carton. Starting pick reserves ATP; an imported or created order alone is a promise rather than a reservation. Reconcile the final stock and ledger.

Practice printing with demo labels first. Demo labels are not paid postage. A live label purchase spends money and is a separate deliberate action on the agreed account. The onboarding walkthrough never buys postage automatically.

## Fulfillment launch acceptance

The following checks reflect a connected-store fulfillment operation with loose-loaded container arrivals, serialized products, multiple cartons, a significant initial backlog, and ongoing direct-to-consumer orders. They are a reusable acceptance plan, not a claim that every customer's service needs all these features.

| Requirement | Current Rackline capability | Acceptance evidence and remaining boundary |
|---|---|---|
| Receive loose-loaded 40-foot containers | ASNs hold a container reference; receipts can be partial or per carton; putaway posts location moves. | Rehearse physical unloading, staging, labor, equipment, count accuracy, damage evidence, and putaway. Software does not establish that a site can unload a container or meet a receiving deadline. |
| Shopify orders arrive automatically | Webhooks, order ingestion, inventory sync, and fulfillment updates exist. | Validate the actual store, authorization, SKU and inventory-location mapping, duplicate delivery, and cancellation. Demo payloads do not prove live access. |
| Tracking for every box returns to Shopify | Per-carton shipment and fulfillment updates exist. | Ship a controlled two-carton order and confirm both tracking records and fulfillment quantities in Shopify. |
| Client sees its stock | Client-scoped read-only portal and organization-scoped read APIs exist. | Compare client-tagged quantities with the portal. API stock is on-hand rather than sellable ATP, and API keys are not client-isolated. Portal/API shipment summaries are order-level; agree any additional carton or serial report. |
| Each product serial is scanned at pack and available by order | Serial assignments associate a unit with order, line, carton, and shipment. Returns has a Find a return lookup; the authenticated lookup API can return matches for an order query. | Pack known serials and test a duplicate and omission. At `/outbound/returns`, enter an individual serial in Find a return, choose Look up, and confirm the displayed order match. This UI displays only the first match, even for an order query; Floor Lookup shows an order summary, not a full serial manifest. A complete serial-by-order report and customer access still require reporting or integration work. An empty serial list is not fully blocked; use an explicit release check. |
| Returns are received, inspected, photographed, then restocked or scrapped | Desktop returns support condition/grade, photos, and dispositions including restock, hold, scrap, and refurb. | Run a photographed return with condition evidence and verify its posted result. Photo/inspection evidence is optional in software; the floor receive form alone does not capture a full inspection. Establish a checked SOP. |
| Labels use the agreed customer FedEx account, including two or more boxes | Own-account live FedEx rates/postage and per-carton labels exist. | Confirm exact account billing, ship-from, parcel dimensions, printer output, every tracking record, and carrier charge. No built-in per-client account-selection policy or no-markup contract guarantee exists. |
| Staff can clear the initial backlog and handle ongoing orders | Named users, role/task permissions, assignment/claiming, due dates, and labor reporting support execution. | Supply a written plan, train staff, run a timed pilot, and verify daily output including rework. A job queue does not prove staffing or throughput. |
| Inventory is insured while in each building | No insurance verification workflow. | Business parties must supply evidence, limits, exclusions, covered locations, claim handling, and responsibility. A completed building setup does not establish coverage. |
| Software, scanners, infrastructure, and integrations are included; carrier markup/rates are agreed | Settings can connect services but do not create commercial terms. | Approve a complete service/rate schedule, account ownership, markup policy, alternative-rate comparison, return charges, and escalation contacts. |

“Available” means code supports the capability, not that a live account or operating site has passed validation. “Partial” means meaningful functionality exists with a material boundary. “External” means the business must establish the requirement independently.

## Plan the surge using your own operating assumptions

A planning example of 1,500–2,500 backer orders dispatched within about two calendar weeks is very different from a later peak of roughly 500 orders per month. Do not use the ongoing monthly average as the staffing target for the launch backlog.

The launch planner requires a lower and upper order count and **manually entered operating days**. It leaves staffing blank until you supply a measured orders-per-person-per-day pilot rate. It does not infer a work schedule from calendar dates or supply a default productivity rate.

| Assumption | Planning result |
|---|---|
| 1,500–2,500 orders over **10 explicitly chosen operating days** | 150–250 orders/day |
| 1,500–2,500 orders over **14 explicitly chosen operating days** | 108–179 whole orders/day, rounded up |
| 500 orders over **20 explicitly chosen operating days per month** | 25 orders/day |

These are arithmetic workloads, not measured capacity or an SLA. Actual operating days may differ. Confirm arrival windows and deadlines directly; the guide does not fix historical or future dates on a customer's behalf.

Measure receiving, putaway, walking/pick, serial pack, printing, carrier handoff, and rework with representative staff and orders. Include units per order, cartons per order, bulky-product handling, breaks, absent staff, unreadable labels, address problems, returns, and inventory differences. Divide the daily workload by a measured sustainable rate to estimate headcount, then have the operating lead review the assumptions and constraints. The calculator rounds order targets and headcount upward separately; it does not validate the measured rate.

Record the pilot results and agreed acceptance tests, name the launch owner and fallback contact, and list unresolved gaps. Release the operation only through the business's actual approval process. Clicking through onboarding is not approval of physical capacity, insurance, commercial terms, or customer readiness.
