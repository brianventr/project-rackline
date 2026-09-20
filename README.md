# Rackline WMS

Cloudflare-native warehouse management for makers who grow into manufacturers.

The public site is a marketing landing page. After sign-in, the floor board, rack map, scan-to-move, Shopify channel, and classic WMS loops run in a shadcn/ui shell (from `shadcn-dashboard-landing-v1/vite-version`).

Iteration 1 covers organization tenancy, inventory in locations, inbound receipts, outbound pick/ship, adjustments, BOMs, and work orders.

Iteration 2 adds bin-to-bin transfers (putaway), cycle counts, the inventory ledger, reorder points / low stock, and document line visibility.

Iteration 3 fills the parked Purchases and Returns slots: vendor POs with partial receive onto the dock, and customer RMAs that receive stock back into a bay.

Iteration 4 aligns blank receipts with that same partial: expected vs received qty, over-receive 409, and the document stays `receiving` until every unit is in.

Iteration 5 adds pick-face replenishment (bulk → pick min), lot/serial overlay on the existing location:item ledger, printable carrier shipping labels with generated `RL-` tracking, and one-step kitting from a recipe.

Iteration 6 adds directed partial picks (suggested pick-face bay, remaining qty, over-pick 409) and printable pack slips. The order stays `picking` until every unit is picked.

Iteration 7 adds a floor Print verb and turns Setup → Labels into a print station: scan a bay, SKU, or order; print barcode sheets, pack slips, and shipping labels.

Iteration 8 adds directed putaway: after receive, the dock suggests a bulk/storage bay per SKU (consolidate, prefer bulk, same aisle as the pick face). Floor Put away can move one SKU onto that bay; Today lists dock stock waiting to be put away.

Iteration 9 makes cycle counts blind: the floor and office hide system qty until the count is posted, typing 0 is a real empty count, empty bays can be confirmed empty, and Today lists posted variances.

Iteration 10 adds inventory holds: lock a bay, a location:item, or a lot so pick, replenish, kit, and move skip it. Qty stays on the ledger. Floor gets a Hold verb; Today lists what is locked. Receive, count, adjust, and ship still run.

Iteration 11 reserves ATP when pick starts: location:item allocations (on-hand − held − allocated). A second order that would oversell returns HTTP 409 (`INSUFFICIENT_ATP`). Create and Shopify ingest stay promises until start. Leftover reservations release on ship, office/floor cancel, or Shopify cancel. Unpick restores the reservation.

Iteration 12 lets a cycle count take an unexpected SKU: scan or add a catalog item that was not on the bay snapshot. Posting still adjusts against current on-hand, so a found SKU with system 0 becomes a +variance.

Iteration 13 adds catch-weight as an overlay on the location:item ledger: flag a SKU, enter grams on receive / pick / count, copy that weight onto ship, and show it on the document and ledger. Qty stays integer pieces. No dual UoM, no catch-weight ATP.

Iteration 14 adds lot expiry / FEFO: flag a SKU, enter a calendar date on receive, pick the earliest unexpired lot first, skip expired stock, and list expiring lots on Today. Qty stays integer pieces on location:item.

Iteration 15 records as-built genealogy when a kit or work order completes: each finished serial/lot is linked to the component lots and serials consumed. Floor Lookup scans a serial or lot. Qty stays integer pieces on location:item.

Iteration 16 adds return disposition on RMA receive: restock (current behavior), scrap (receive then scrap so on-hand is unchanged), or hold (receive then a QC hold on the bay SKU). Invalid disposition is HTTP 400. Qty stays integer pieces on location:item.

Iteration 17 adds directed partial pack: lines track packed vs picked qty, over-pack 409, and the order stays `packing` until every picked unit is in the box. Qty stays integer pieces on location:item.

Iteration 18 adds directed partial putaway: transfer lines track moved vs expected qty, over-move 409, and the document stays `in_progress` until every unit has left the from-bay. Qty stays integer pieces on location:item.

Iteration 19 adds vendor RTV: an outbound return-to-vendor document under Inbound. Lines track returned vs expected qty, over-return 409, and stock leaves the from-bay (`rtv` movement). The document stays `returning` until every unit is shipped back.

Iteration 20 adds dekit: reverse a fully completed kit using its as-built lots and serials. Finished goods leave the output bay; components return to the source bay. Partial kits cannot be dekitted.

Iteration 21 adds partial kit / work-order complete: headers track `qty_completed` vs qty, over-complete 409, and the document stays `in_progress` until the header qty is filled. Each complete posts BOM × this-complete qty and writes as-built for that slice.

Iteration 22 adds partial replenish: tickets track moved vs expected qty, over-move 409, and the document stays `in_progress` until the pick face qty is filled.

Iteration 23 adds unpick and office/floor cancel: unpacked qty returns to the bay (`unpick` movement), leftover ATP is restored, and cancel restores picked (including packed) qty then releases allocations. Shopify `orders/cancelled` uses the same restore.

Iteration 24 opens the parked logistics set on the same location:item ledger:

- **Zones** — aisle/area zones; bays can join a zone for wave scoping
- **Waves / batch** — group open orders into `WAV-` (`wave` or `batch`). Batch release consolidates SKU qty; floor batch-pick spreads across orders (over-batch 409)
- **ASN** — vendor advance notices (`ASN-`) receive like a PO (partial qty, over-receive 409)
- **3PL clients** — client codes tag orders, ASNs, and waves (qty stays on location:item)
- **Yard** — trailer visits (`YRD-`) check in, take a dock bay, check out
- **Labor** — floor posts append labor events; Setup → Labor rolls them up by user
- **Multi-warehouse** — create another building, cross-building transfers stamp `toWarehouseId`

Iteration 25 adds an optional pick map on the ticket: remaining SKUs become numbered walk stops on the floor plan and 3D racks. Tap a stop to set the pick-from bay. Qty stays integer pieces on location:item.

Iteration 26 adds carrier integrations: Setup → Carriers is a Shopify-shaped pathway to connect your own UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine account, enable services, test, shop canned rates, and buy/void labels. Tracking prefixes follow the carrier (`1Z`, `9400`, `FE-`, `DHL-`, `RL-`). Live mode stores credentials and logs the payload; it does not purchase postage yet.

Iteration 27 adds Analytics → Traffic: a live ATC-style country/state map of packed and in-flight orders plus SKU destination demand. Positions are lane estimates from warehouse origin → parsed ship-to (city/state/country), not carrier GPS.

Iteration 28 adds equipment custody: register forklifts and pallet jacks, exclusive operator checkout for a shift and/or WMS document, OSHA-style pre-use inspection, and stamp the truck onto inventory movements. Fail inspection marks the machine out of service. Qty stays integer pieces on location:item.

Iteration 29 scores staff against SKUs: Performance (owners) rolls lines, units, pace (0–10 vs expected time from lot/serial/catch-weight/expiry and map walk), and exceptions from the ledger plus pack events. Operators see My day on the floor. Slow SKUs are flagged separately from slow people. Northwind seeds picker Maya Chen (`maya@northwind.makers`) and dock operator Jordan Dock (`jordan@northwind.makers`) on `ORD-KPI1`; both sign in with `rackline-demo`.

Shopify checkouts land as pick tickets; after ship, Rackline posts fulfillment back to Shopify. Locations can sit on a warehouse map with barcodes and scan-to-move.

## Stack

- Cloudflare Workers + [Hono](https://hono.dev) API
- D1 (SQLite) + Drizzle
- Vite + React + Tailwind v4 + shadcn/ui, served as Workers static assets
- Better Auth email/password
- Shopify Admin GraphQL + HMAC-signed webhooks

## Local development

```bash
npm install
npx wrangler d1 migrations apply rackline --local
npm test
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Guests see the landing page. Sign in at `/login`.

On the sign-in screen, either:

- Create an organization, or
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM, dock / aisle A (two racks, two levels) / aisle B / shop / outbound, reorder points, an open receipt `RCP-DEMO1` (12× LED-BULB + 6× SHADE — partial receive is allowed), purchase order `PO-DEMO1` (Harbor Components), ASN `ASN-DEMO1` (expected Harbor notice), yard visit `YRD-DEMO1` (UPS Freight / TRL-4421), wave `WAV-DEMO1` (batch mode for Acme `ORD-WAVE1` / `ORD-WAVE2`), 3PL client `ACME`, zones A/B on Main, a second warehouse **West shop** with `XFR-WEST1` (4× SHADE cross-building), vendor return `RTV-DEMO1` (2× LED-BULB from `A-01-01` — partial return is allowed), return `RMA-DEMO1` (Harbor Workshop, restock), putaway ticket `XFR-DEMO1` (8× SHADE + 6× BASE from `A-01-01` to `A-02-02` — partial move is allowed), replenishment `RPL-DEMO1` (14× LED-BULB from `A-01-01` to `A-01-02` — partial move is allowed), a floor order, Shopify order `#1004` (Maya Chen), work order `WO-DEMO1` (qty 4 — partial complete is allowed), kit `KIT-DEMO1` (qty 2 — partial complete, then dekit), sit-down `FL-01` checked out on days against `XFR-DEMO1` (`CST-DEMO1`), pallet jack `PJ-01` with a closed yesterday assignment, `FL-02` out of service after a failed horn/leak inspection, shipped `ORD-KPI1` (Maya pick/pack of BASE / GLUE / LAMP plus an unpick), Jordan Dock inbound BASE and RESIN, and in-flight demo tickets on **Analytics → Traffic**. LED-BULB is lot-tracked (`LOT-2026-A` / `LOT-2026-B`) with pick min 20 on `A-01-02`; LAMP is serial-tracked (`LAMP-1001`–`LAMP-1014`) with pick min 12 on `B-01-01`; RESIN is catch-weight (6 bottles / 3000 g on `A-01-01`); GLUE is lot + expiry (`LOT-OLD` / `LOT-NEW` on `A-01-01`, expired `LOT-DEAD` on `A-01-03`). `LAMP-1001` is seeded with as-built component lots. Setup → Carriers has demo UPS `A1B2C3` and USPS accounts plus Rackline Ground. Then open **Map**, **Traffic**, **Performance**, and **Move**.

`wrangler.jsonc` uses a placeholder `database_id`. Local D1 does not need a Cloudflare account. When you are ready to deploy:

```bash
npx wrangler d1 create rackline
# paste the returned database_id into wrangler.jsonc
npx wrangler d1 migrations apply rackline --remote
npm run deploy
```

Set a real `BETTER_AUTH_SECRET` (32+ characters) and `BETTER_AUTH_URL` before production.

## Shopify channel

Customer checkout on Shopify becomes a Rackline pick ticket. After the floor picks and ships, Rackline posts `fulfillmentCreate` back to Shopify.

1. In Shopify Admin, create a custom app with:
   - `read_orders`
   - `write_orders`
   - `read_merchant_managed_fulfillment_orders`
   - `write_merchant_managed_fulfillment_orders`
   - `read_assigned_fulfillment_orders`
   - `write_assigned_fulfillment_orders`
2. Install the app and copy the Admin API access token.
3. Subscribe HTTPS webhooks for `orders/create`, `orders/updated`, `orders/paid`, and `orders/cancelled` to `/api/shopify/webhooks`.
4. Optional fulfillment-service callback prefix: `/api/shopify` so Shopify posts `/api/shopify/fulfillment_order_notification`.
5. On **Shopify** in Rackline, paste shop domain, token, and webhook signing secret. Use **Demo** mode until the token is in place.

HMAC is verified on the raw body (`X-Shopify-Hmac-SHA256`). Duplicate deliveries (`X-Shopify-Webhook-Id`) are ignored. Line items map to catalog SKUs (unknown SKUs are created as finished goods). Ship from **Orders** sends tracking when provided.

Demo mode never calls Shopify; it stores the GraphQL payload that would have been sent. Northwind includes a demo connection for `northwind-makers.myshopify.com`.

## Carriers

Owners connect shipping accounts on **Setup → Carriers**. The catalog matches how ShipStation, ShipHero, and EasyPost present BYO accounts: pick a provider, paste credentials, test, enable services, set a default, and save a warehouse ship-from.

1. **Direct** — UPS, FedEx, USPS, DHL with your account number and API key / secret / meter.
2. **Aggregator** — EasyPost or ShipEngine with one API key. Demo mode unlocks UPS, FedEx, USPS, and DHL services under that connection.
3. **Rackline Ground** — always available. Cannot be disconnected.

**Enable demo carriers** seeds Northwind-style UPS (`A1B2C3`) and USPS accounts plus Rackline Ground. Demo never calls a carrier. Live mode requires the provider's secrets, stores them (never echoed back), and records the test/buy payload; postage is not purchased yet.

Office Orders and Floor Ship load enabled services, **Shop rates**, **Buy label**, and **Void** (blocked after ship). Tracking URLs point at the carrier's public tracker.

## Inventory rules

All quantity changes go through one engine (`src/domain/inventory.ts`) and an append-only movement ledger.

- **Receive** adds qty to a location (blank receipt, purchase order, or customer return). Lines track received vs expected; posting more than remaining returns HTTP 409 (`OVER_RECEIVE`); the document stays `receiving` until every unit is in. Return lines choose restock, scrap, or hold; scrap writes receive then scrap in one persist so on-hand is unchanged; hold opens a QC lock on the bay SKU after receive; unknown disposition is HTTP 400
- **Move / transfer** decrements the from bin and increments the to bin in one ledger movement. Lines track moved vs expected; posting more than remaining returns HTTP 409 (`OVER_MOVE`); the document stays `in_progress` until every unit is moved. Dock, ship, and bench stock get a suggested bulk/storage bay (same idea as directed pick). Moves cannot steal qty reserved for an open pick
- **Pick** decrements the pick bin. Starting pick reserves remaining qty against ATP (on-hand − held − allocated) on location:item. A second start that would oversell returns HTTP 409 (`INSUFFICIENT_ATP`). Lines track picked vs ordered; posting more than remaining returns HTTP 409 (`OVER_PICK`); the document stays `picking` until every unit is picked. The API suggests a pick-face bay that still covers remaining qty for this order. Floor Pick and the order record can open an optional pick map: remaining SKUs are numbered walk stops on the floor plan and 3D racks; tap a stop to set the pick-from bay. Unpick puts unpacked qty back on a bay (`unpick` movement) and restores ATP; posting more than unpacked remaining returns HTTP 409 (`OVER_UNPICK`). Cancel restores all picked qty (including packed), releases allocations, and marks the order `cancelled`. Shipped orders cannot be cancelled.
- **Pack slip** prints ordered vs picked vs packed qty from the order record
- **Pack** posts packed qty against picked qty. Posting more than remaining returns HTTP 409 (`OVER_PACK`); the document stays `packing` until every picked unit is in the box. Pack does not move the location:item ledger (qty already left at pick)
- **Ship** writes an outbound movement (qty already left at pick), releases leftover allocations, and, for Shopify orders, creates a fulfillment
- **Adjust** applies a signed delta with a reason
- **Cycle count** snapshots a bin without showing system qty. Every SKU must be entered (0 is a real count); posting more than once is blocked. Empty bays can be confirmed empty. A SKU that was not on the snapshot can be scanned or added; posting still adjusts against *current* on-hand so concurrent movement is not double-applied; Today lists posted counts where counted ≠ system
- **Hold** locks a bay, a SKU in a bay, or a lot. Pick, move, replenish, kit consume, work-order consume, and vendor RTV return HTTP 409 (`HELD_STOCK`). Receive, count, adjust, produce, ship, and scrap still post. FIFO skips held lots when other lots cover the qty. A return received as hold opens a QC lock on the bay SKU (or lot) after the receive
- **Allocate** reserves remaining order qty on pick start against location:item ATP. Pick, move, replenish, kit consume, work-order consume, and vendor RTV return HTTP 409 (`INSUFFICIENT_ATP`) when they would take another order's reservation. Receive, count, adjust, produce, ship, and unpick still post. Leftover reservations release on ship, office/floor cancel, or Shopify cancel. Unpick restores the reservation on the bay the qty returned to.
- **Work order complete** consumes `BOM qty × this-complete qty` from the source location and produces finished goods into the output location. Header `qty_completed` vs qty; posting more than remaining returns HTTP 409 (`OVER_COMPLETE`); the document stays `in_progress` until the header qty is filled. Short components return HTTP 409
- **Kit complete** is the same explode, in one step, with `kit_consume` / `kit_produce` ledger types. Completing a kit or work order writes as-built links from each finished serial/lot to the component lots/serials consumed
- **Dekit** reverses a fully completed kit from its as-built rows: consume finished from the output bay, restore components onto the source bay. In-progress kits cannot be dekitted. Status becomes `dekitted`
- **Vendor RTV** decrements the from-bay (`rtv` movement). Lines track returned vs expected; posting more than remaining returns HTTP 409 (`OVER_RETURN`); the document stays `returning` until every unit is shipped back. Holds and ATP apply like pick
- **As-built** is lookup, not a second qty ledger. Floor Lookup scans a serial (`LAMP-1001`) or lot (`LOT-2026-A`) and shows built-from / used-in. The office item, kit, and work-order records show the same links
- **Replenish** moves bulk storage onto a pick face when on-hand is below the SKU's pick min. Tickets track moved vs expected qty; posting more than remaining returns HTTP 409 (`OVER_MOVE`); the document stays `in_progress` until every unit is moved
- **Lots / serials** overlay the location:item balance. Receive requires a vendor lot or matching serials; pick/move FIFO the oldest lot or serial if omitted
- **Shipping label** buys from a connected carrier account (Setup → Carriers). Demo mints `1Z` / `9400` / `FE-` / `DHL-` / `RL-` tracking; void is allowed until ship. Shop rates returns canned quotes from enabled services.
- **Print station** scans a bay, SKU, or order. Pack slips queue once picking has started; shipping labels once the ticket is picked. Floor **Print** and Setup **Labels** share that queue
- **Reorder point** flags SKUs at or below the threshold on the floor board
- **Zone** tags bays on a warehouse for wave scoping. Qty stays on location:item
- **Wave / batch** groups open orders. Batch release consolidates remaining SKU qty; floor batch-pick posts picks across those orders and returns HTTP 409 (`OVER_BATCH_PICK`) when over. Qty stays integer pieces on location:item
- **ASN** is a vendor advance notice that receives like a purchase (partial qty, over-receive 409)
- **3PL client** tags documents (orders, ASNs, waves). Inventory is not split by client on the ledger
- **Yard visit** tracks a trailer from expected → checked in → at dock → checked out
- **Labor** scores staff from the movement ledger and pack events (lines, units, difficulty-adjusted pace 0–10, exceptions). Performance is owner-only; operators see My day on the floor. Seeded receive (`refType=seed`) and non-members are excluded. Pack posts `pack_events` because pack does not move location:item qty
- **Equipment** registers powered industrial trucks. Exclusive checkout records who had the machine on a shift or WMS document. Pre-use inspection is required; a fail marks the truck out of service (`INSPECTION_FAILED`). Missing or expired class certs return HTTP 409 (`CERT_REQUIRED` / `CERT_EXPIRED`). A second checkout on the same truck or operator returns HTTP 409 (`EQUIPMENT_IN_USE` / `OPERATOR_CHECKED_OUT`). Pick and putaway still run without a truck; if the operator is checked out, the ledger stamps `equipment_id`
- **Multi-warehouse** lets owners add buildings; transfers may target another warehouse (`toWarehouseId`) and scan-to-move may cross buildings

## Roles

- `owner` — full catalog, including deletes, Shopify credentials, clients, zones, and extra warehouses
- `operator` — floor actions (receive, ASN, transfer, pick, wave batch-pick, unpick, cancel, ship, complete WO, kit, dekit, vendor RTV, cycle count, hold, yard, equipment checkout, adjust) and Shopify order simulation. Cannot delete items, locations, or BOMs

Signup creates an organization plus a default **Main warehouse**.
