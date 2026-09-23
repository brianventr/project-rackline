# Rackline WMS

Cloudflare-native warehouse management. Start in Garage Mode, then open the full warehouse.

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

Iteration 26 adds carrier integrations: Setup → Carriers is a Shopify-shaped pathway to connect your own UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine account, enable services, test, shop rates, and buy/void labels. Tracking prefixes follow the carrier (`1Z`, `9400`, `FE-`, `DHL-`, `RL-`). Live EasyPost / ShipEngine purchase postage; direct carrier live mode stores credentials without buying postage.

Iteration 27 adds Analytics → Traffic: a live ATC-style country/state map of packed and in-flight orders plus SKU destination demand. Positions are lane estimates from warehouse origin → parsed ship-to (city/state/country), not carrier GPS.

Iteration 28 adds equipment custody: register forklifts and pallet jacks, exclusive operator checkout for a shift and/or WMS document, OSHA-style pre-use inspection, and stamp the truck onto inventory movements. Fail inspection marks the machine out of service. Qty stays integer pieces on location:item.

Iteration 29 adds floor jobs on top of the existing documents: assign, claim, and a ranked next-job queue across dock, aisles, and bench. Unassigned work stays pickable. First scan or post auto-claims. A second operator hitting a claimed job gets HTTP 409 (`JOB_CLAIMED`). Ranking uses pin, starved replenish, FEFO, dock dwell, due/age, and walk distance from the last bay.

Iteration 30 scores staff against SKUs: Performance (owners) rolls lines, units, pace (0–10 vs expected time from lot/serial/catch-weight/expiry and map walk), and exceptions from the ledger plus pack events. Operators see My day on the floor. Slow SKUs are flagged separately from slow people. Northwind seeds picker Maya Chen (`maya@northwind.makers`) and dock operator Jordan Dock (`jordan@northwind.makers`) on `ORD-KPI1`; both sign in with `rackline-demo`.

Iteration 31 pushes Rackline sellable qty to Shopify: on-hand − held − remaining-to-pick (open / picking tickets). Demo records `inventorySetQuantities`; live calls Admin GraphQL. SKUs without a Shopify inventory item are skipped. Live sync without a location GID returns HTTP 409 (`MISSING_LOCATION`). Stock posts never fail because Shopify is unreachable. Ingest is still a promise until pick start.

Iteration 32 buys live postage from EasyPost or ShipEngine only. Shop rates / Buy label / Void call the aggregator when the connection is live. Direct UPS/FedEx/USPS/DHL live accounts still store credentials and mint tracking locally. Paste an existing tracking number to skip the live buy. Missing street/city/region/postal on ship-from or ship-to returns HTTP 409 (`LIVE_ADDRESS`).

Iteration 33 drafts a PO from Today’s reorder queue: qty is `max(1, reorder point − on-hand)`, last vendor on the SKU (or the majority vendor), SKUs already on an open PO are skipped.

Iteration 34 packs cartons: `BOX-1` / `BOX-2` with weight and dims per box. Buy or void a label per carton (EasyPost/ShipEngine live, demo mint otherwise). Ship when every packed unit is in a carton that has tracking. Qty already left the bay at pick. Cartons are optional until the first box exists — then every packed unit must be labeled before ship. Order-level buy on a multi-carton ticket returns HTTP 409 (`NEED_PACKAGE`). Shopify fulfillment posted the first carton’s tracking until iteration 37.

Iteration 35 feeds EasyPost and ShipEngine tracker webhooks into Traffic. Demo records the payload. `pre_transit` / `in_transit` / `delivered` map onto at-gate / in-flight / arrived. The geodesic lane estimate is used only when no tracker status is present. Direct-carrier demo labels stay estimated. Traffic’s Arrived KPI counts tracker-delivered and estimated arrivals in the selected horizon.

Iteration 36 sends a draft PO: Mark ordered emails or records a send (demo stores the message), stamps `orderedAt`, and mints an expected `ASN-` for remaining qty. SKUs already on an open ASN (draft / expected / receiving) are skipped. No vendor portal, no X12.

Iteration 37 posts every labeled carton to Shopify `fulfillmentCreate` as a `trackingInfo` array. Orders with no packages keep a single order-level tracking element. The pack slip lists each `BOX-n` barcode, SKU × qty, and tracking.

Iteration 38 maps tracker `failure` / `return_to_sender` / `cancelled` / `error` onto a fourth status `exception`. Any carton exception wins the order rollup. Today lists tracker exceptions. Traffic counts them on the Exceptions KPI, keeps them off the geodesic arcs, and still heats the dest on 7d / 30d. Delivered stays Arrived. Geodesic is used only when no tracker status is present. No GPS or delay math.

Iteration 39 takes vendor boxes on an expected ASN (`BOX-n`, optional SSCC, JSON paste, no X12). Floor Receive posts one carton at a time. Over-carton is HTTP 409 (`OVER_CARTON`). Lines still over-receive 409. Cartons are optional until the first box exists — then loose receive is HTTP 409 (`NEED_PACKAGE`). No vendor portal.

Iteration 40 relabels a tracker exception: Today and the order buy a replacement label (demo mint / live EasyPost-ShipEngine). The exception clears at `pre_transit`. Void the old aggregator label only if it is still voidable; a failed void still buys the new label. No GPS, delay math, or auto-RMA.

Iteration 41 carries `lotCode` / `serials` / `weightGrams` / `expiresOn` on vendor carton JSON and lines. Floor Receive uses those values when present, otherwise the form. Demo `ASN-DEMO1` `BOX-1` seeds `LOT-2026-A` on LED-BULB.

Iteration 42 puts away one received vendor `BOX-n` / SSCC onto suggested bays. Qty stays on location:item — no second carton ledger. Cartons are optional until the first received box exists — then loose dock putaway is HTTP 409 (`NEED_PACKAGE`). Putaway of an unreceived or already-put-away carton is 409.

Iteration 43 adds Analytics → Runway: live days-until-stockout per SKU from a saved baseline ship rate (or observed 7/30/90d velocity). Cover is sellable qty (on-hand − held − remaining-to-pick), plus dated ASN/PO inbound, minus BOM component burn and lots that expire before they would ship. Order-by is stockout minus inferred lead time. Today lists SKUs that run out this week beside the reorder queue. Draft PO from order-today SKUs covers lead + 14 days of burn. Qty stays integer pieces on location:item.

Iteration 44 drops an outbound `BOX-n` (uncarton) and unreives an inbound vendor carton still on the dock. Qty stays integer pieces on location:item — no second carton ledger. Uncarton voids a purchased label when it can, then deletes the box so packed units can be boxed again (`nextCartonSeq` is max seq + 1). Unreceive reverses dock qty (`unreceive` movement with carton lots/serials/client overlay) and reopens the ASN. Put-away cartons return HTTP 409 (`ALREADY_PUTAWAY`); a carton that was never received returns 409 (`NOT_RECEIVED`). Over-unreceive is 409 (`OVER_UNRECEIVE`).

Iteration 45 ships one labeled carton while the ticket stays `packing` / `packed`. Qty already left the bay at pick — carton ship stamps that box’s qty without changing location:item or 3PL client overlay. Allocations release only when the order is fully packed and every packed unit is in a shipped carton. HTTP 409 (`NEED_PACKAGE` / `SHIPPED`). Floor Ship lists packing tickets that still have a labeled box. The ship job is not claimed while the ticket is still packing.

Iteration 46 posts Shopify `fulfillmentCreate` per shipped carton with that box’s `trackingInfo` and line items. Orders with no packages keep one order-level fulfillment at final ship. Retry remaining shipped cartons that lack a fulfillment id. Ingest stays a promise until pick start.

Iteration 47 short-ships a packing or packed order once at least one carton has left. Shipped carton qty stays out. Unshipped qty that left the bay returns, and the parent line stamps drop to the shipped qty. Allocations release. The order becomes `shipped` with shipped qty below ordered qty. Nothing shipped returns HTTP 409 (`NOTHING_SHIPPED`) — that case is still Cancel. Every ordered unit already in a shipped carton returns 409 (`NO_REMAINDER`). Cancel after a carton has shipped returns 409 (`SHIPPED`). Unshipped cartons are voided when the label is still live, then dropped. Qty stays integer pieces on location:item.

Iteration 48 mints a child open order for ordered minus shipped, same customer and ship-to. The child does not reserve ATP until pick start. Number is `{parent}-BO`, then `{parent}-BO2` when that number is taken. The parent keeps the cartons that already left.

Iteration 49 does not create a second Shopify order. The child copies the parent fulfillment-order ids and line item ids and omits `shopifyOrderId`. A later ship of the backorder posts `fulfillmentCreate` on the original order for that carton only. Sellable qty updates after the unpick in 47. Cancelling the original Shopify order also cancels open backorder children. Ingest stays a promise until pick start.

Iteration 50 sends a purchase order by email when `MAIL_API_KEY` and `MAIL_FROM` are set and the vendor address is an email. Explicit Send returns HTTP 409 (`MAIL_ADDRESS`) when mail is configured and the address is not an email, and 409 (`MAIL_FAILED`) when the provider rejects the message — the purchase stays draft. Receive-from-draft still records a demo send when there is no email, so the dock is not blocked. With mail unset, Send records the demo message as before.

Iteration 51 installs Shopify with OAuth. Owners start from the shop domain; the callback stores a live Admin token and uses the app secret as the webhook signing secret. Missing `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` returns HTTP 409 (`MISSING_APP`). Pasting an Admin token still works.

Iteration 52 buys, voids, and shops rates on live UPS, FedEx, USPS, and DHL accounts. Demo connections still mint local tracking. A live buy that fails returns HTTP 409 (`CARRIER_LIVE`) and does not invent a tracking number. FedEx stores the client secret in the meter number field. USPS uses the API key as a bearer token. This replaces the direct-carrier limit in iterations 26 and 32.

Iteration 53 drafts one invoice per 3PL client from warehouse activity: 2¢ per on-hand piece, 25¢ per unit picked in the last 30 days, and $1.50 per carton shipped in that period. House stock is not billed. No activity returns HTTP 409 (`NOTHING_TO_BILL`). This replaces the $5-per-client stub in iteration 25.

Iteration 55 names the founder bench **Garage Mode**. New organizations start there: receive, make, pick, pack, ship, recipes, and runway. Yard, waves, ASN, equipment, replenishment, holds, counts, 3PL clients, EDI, and traffic stay packed away until Setup → Warehouse opens the full warehouse on the same ledger. Northwind stays a full warehouse so the seeded shop is unchanged. Invalid mode is HTTP 400.

Iteration 56 is trust: password reset and teammate invite email (same Resend-compatible mail as purchase send), an append-only Setup → Audit log of mutations and 409s, `BETTER_AUTH_SECRET` out of committed wrangler vars, and route-guard tests for owner-only 403s, org 404s, and the 409 contract. Invite without a starter password returns HTTP 409 (`MAIL_UNAVAILABLE`) until mail is set. Production without a 32-character secret fails closed.

Iteration 57 adds Today → Live: the wall view of this building's day. Position is the last scan bay, not GPS. Pace is the last 60 minutes and stays blank until 15 minutes of work exist; clear-by is now plus remaining units over that pace. Owners only. The day starts at local midnight in the warehouse timezone (`America/Los_Angeles` on Northwind). An invalid timezone on warehouse save is HTTP 400.

Iteration 58 adds Promise: a leave-by for every open order, and for a new qty of a SKU. The quote uses the shelf (on-hand minus holds, with lots that expire before the pickup left out), the pick queue in front, live floor pace (or 40 units an hour until 15 minutes of work exist), a 3:00pm warehouse-local carrier cutoff, and dated inbound — expected or receiving ASNs, and ordered or receiving POs net of that ASN — plus four hours of dock-to-shelf. Draft POs are not cover. Orders a carrier already has (in transit, delivered, or a tracker exception) stay off the board. A promise does not reserve inventory, and it is not split by 3PL client. ATP still waits for pick start, and a second start can still return HTTP 409 (`INSUFFICIENT_ATP`). Analytics → Promise is on the founder bench. `GET /api/analytics/promises/ask?sku&qty` is the same answer a checkout or a buying agent would read (`reservesStock: false`).

Iteration 59 locates the selected Today row on the racks. Click a row and the rail widens into a card with the document, its action, and where the work is: a rack front view (bays × levels) over a floor plan, or the 3D racks with the camera flown to the bay. A crosshair marks the bay the work points at; the bay stock comes from is a green ring. Receipts, POs, and ASNs point at where each SKU is going — the dock it lands on, then the bay directed putaway sends it to from there. Putaway, replenish, kit, and work order point at the destination; orders at their pick bays (allocations first); RTV, holds, counts, variances, and FEFO at their bay; runway at every bay holding the SKU. Flat or 3D is remembered per browser. Below 1280px the card opens as a side sheet. Nothing is reserved or moved.

Iteration 54 adds one photo per SKU and numbered kitting steps on the recipe. Floor Kit and Assemble show the photo, steps, and components; Pick and Lookup use the same thumbnail. Paste a URL or upload to R2 (`MEDIA`). Shopify copies a line image onto a new or photo-less SKU only. Complete is still one-step explode. Qty stays integer pieces on location:item.

Shopify checkouts land as pick tickets; after ship, Rackline posts fulfillment back to Shopify. Locations can sit on a warehouse map with barcodes and scan-to-move.

Iteration 25 deepens logistics on the same location:item ledger (qty stays integer stock units):

- **3PL client stock** — `client_balances` overlay per location:item:client; receive/pick/ship stamp `client_id` on movements; outbound checks client qty (409 `CLIENT_STOCK`)
- **Zone-directed picks** — wave `zoneId` prefers bays in that zone when suggesting pick faces
- **Labor clocks** — clock in/out on a ref posts duration to labor events; GET `/api/labor` includes open clocks
- **Yard ↔ ASN** — dock assign ties linked ASN to the dock bay; floor/office **Receive ASN** receives at dock
- **Multi-WH ATP/holds** — `persistStockPlan` scopes holds and ATP checks to warehouses touched by the movement
- **Carriers** — FedEx/DHL services and account numbers; tracking prefixes `FE-` / `DHL-`
- **Supplier EDI (thin)** — POST `/api/edi/asn` creates expected ASN + `edi_inbox` row
- **Dual UoM (thin)** — optional `alt_uom` / `alt_per_stock`; receive/pick accept `altQty` converted to stock pieces
- **Billing (thin)** — 3PL plan stub; generate draft invoice = client count × $5 (superseded by iteration 53)

Iteration 26 adds hardware support for the floor:

- **Scanner** — HID guns stay global; typed FloorScanBox emits `typed` scans; camera uses Chromium `BarcodeDetector` with **ZXing** fallback; GS1 AI `(01)/(10)/(21)` parse; lookup shows wave/ASN/yard
- **Printers** — org `printers` + `print_stations` + `print_jobs`; Setup → Printers binds this workstation; Floor Print / shipping labels dispatch via **browser**, **QZ Tray**, or **ZPL download**
- **ZPL** — bay, SKU, and 4×6 shipping templates; sheet pages can download a ZPL batch

## Stack

- Cloudflare Workers + [Hono](https://hono.dev) API
- D1 (SQLite) + Drizzle
- Vite + React + Tailwind v4 + shadcn/ui, served as Workers static assets
- Better Auth email/password
- Shopify Admin GraphQL + HMAC-signed webhooks

## Local development

```bash
npm install
cp dev.vars.example .dev.vars
npx wrangler d1 migrations apply rackline --local
npm test
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Guests see the landing page. Sign in at `/login`.

On the sign-in screen, either:

- Create an organization (starts in Garage Mode), or
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM with photos and four kitting steps, dock / aisle A (two racks, two levels) / aisle B / shop / outbound, reorder points, an open receipt `RCP-DEMO1` (12× LED-BULB + 6× SHADE — partial receive is allowed), purchase order `PO-DEMO1` (Harbor Components), ASN `ASN-DEMO1` (expected Harbor notice with vendor `BOX-1` 10× LED-BULB `LOT-2026-A` and `BOX-2` 10× LED-BULB + 8× SHADE), yard visit `YRD-DEMO1` (UPS Freight / TRL-4421), wave `WAV-DEMO1` (batch mode for Acme `ORD-WAVE1` / `ORD-WAVE2`), 3PL client `ACME`, zones A/B on Main, a second warehouse **West shop** with `XFR-WEST1` (4× SHADE cross-building), vendor return `RTV-DEMO1` (2× LED-BULB from `A-01-01` — partial return is allowed), return `RMA-DEMO1` (Harbor Workshop, restock), putaway ticket `XFR-DEMO1` (8× SHADE + 6× BASE from `A-01-01` to `A-02-02` — partial move is allowed), replenishment `RPL-DEMO1` (14× LED-BULB from `A-01-01` to `A-01-02` — partial move is allowed), a floor order (`ORD-DEMO1` pick assigned to you), Shopify order `#1004` (Maya Chen), work order `WO-DEMO1` (qty 4 — assigned to assemble; partial complete is allowed), kit `KIT-DEMO1` (qty 2 — partial complete, then dekit), sit-down `FL-01` checked out on days against `XFR-DEMO1` (`CST-DEMO1`), pallet jack `PJ-01` with a closed yesterday assignment, `FL-02` out of service after a failed horn/leak inspection, shipped `ORD-KPI1` (Maya pick/pack of BASE / GLUE / LAMP plus an unpick), Jordan Dock inbound BASE and RESIN, and in-flight demo tickets on **Analytics → Traffic** (packed `ORD-DFW1` split into labeled `BOX-1` / `BOX-2` — `BOX-1` is a tracker exception; `ORD-MIA1` is an order-level tracker exception). LED-BULB is lot-tracked (`LOT-2026-A` / `LOT-2026-B`) with pick min 20 on `A-01-02`; LAMP is serial-tracked (`LAMP-1001`–`LAMP-1014`) with pick min 12 on `B-01-01`; RESIN is catch-weight (6 bottles / 3000 g on `A-01-01`); GLUE is lot + expiry (`LOT-OLD` / `LOT-NEW` on `A-01-01`, expired `LOT-DEAD` on `A-01-03`). `LAMP-1001` is seeded with as-built component lots. Setup → Carriers has demo UPS `A1B2C3` and USPS accounts plus Rackline Ground. Then open **Today** for the dispatch board, **Live** for the day on the wall, **Floor** for next job, **Map**, **Traffic**, **Runway**, **Promise**, **Performance**, and **Move**. CORD ships at a baseline of 5/day so Today’s **Runs out this week** card has a velocity row even while the draft `PO-CORD` covers the static reorder gap.


Local D1 does not need a Cloudflare account. The deployed Worker is `rackline` on `https://rackline.brian-72c.workers.dev`, with D1 database `rackline` (`8c92d366-90f5-4743-bc2f-7888ab3c1405`) and R2 bucket `rackline-media`. `BETTER_AUTH_SECRET` is a Wrangler secret, not a committed var.

Merging to `main` deploys on its own: the **Deploy** GitHub Actions workflow (`.github/workflows/deploy.yml`) typechecks, tests, and builds, then applies pending D1 migrations with `--remote` and runs `npm run deploy`. Pull requests get the checks only. The workflow needs two repository secrets, `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit and D1: Edit) and `CLOUDFLARE_ACCOUNT_ID`. To redeploy `main` without a merge, run the workflow from the Actions tab. To deploy by hand instead:

```bash
npx wrangler d1 migrations apply rackline --remote
npx wrangler secret put BETTER_AUTH_SECRET
npm run deploy
```

Set `BETTER_AUTH_SECRET` (32+ characters) as a Wrangler secret — it is not in `wrangler.jsonc`. Optional `BETTER_AUTH_URL` is the public origin. Optional: `MAIL_API_KEY` and `MAIL_FROM` send purchase orders, password resets, and teammate invites through a Resend-compatible API. Optional: `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` enable the Shopify OAuth install. Do not commit those secrets. Local `.dev.vars` is gitignored; start from `dev.vars.example`.

## Shopify channel

Customer checkout on Shopify becomes a Rackline pick ticket. After the floor picks and ships, Rackline posts `fulfillmentCreate` back to Shopify.

1. In Shopify Admin, create a custom app with:
   - `read_orders`
   - `write_orders`
   - `read_merchant_managed_fulfillment_orders`
   - `write_merchant_managed_fulfillment_orders`
   - `read_assigned_fulfillment_orders`
   - `write_assigned_fulfillment_orders`
   - `read_inventory`
   - `write_inventory`
   - `read_locations`
   - `read_products`
2. Install the app and copy the Admin API access token.
3. Subscribe HTTPS webhooks for `orders/create`, `orders/updated`, `orders/paid`, and `orders/cancelled` to `/api/shopify/webhooks`.
4. Optional fulfillment-service callback prefix: `/api/shopify` so Shopify posts `/api/shopify/fulfillment_order_notification`.
5. On **Shopify** in Rackline, paste shop domain, token, and webhook signing secret, or choose **Install Shopify app** when `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are set. Pick the Shopify location that should receive sellable qty. Use **Demo** mode until the token is in place.

HMAC is verified on the raw body (`X-Shopify-Hmac-SHA256`). Duplicate deliveries (`X-Shopify-Webhook-Id`) are ignored. Line items map to catalog SKUs (unknown SKUs are created as finished goods). Ship from **Orders** posts one `fulfillmentCreate` per shipped carton (orders with no packages keep a single order-level fulfillment).

Sellable qty (`on-hand − held − remaining to pick`) is pushed with `inventorySetQuantities` after stock posts, ingest, hold, cancel, and **Push sellable**. Demo records the GraphQL payload. Live skips SKUs with no inventory item. A live shop without a location GID returns HTTP 409 (`MISSING_LOCATION`); automatic sync records a failed outbound event instead of failing the WMS post.

Demo mode never calls Shopify; it stores the GraphQL payload that would have been sent. Northwind includes a demo connection for `northwind-makers.myshopify.com` and demo inventory item GIDs. CORD is seeded at 25 with reorder point 40 so Today has a reorder row. `PO-CORD` is a draft Harbor PO for 15× CORD — Send & mark ordered records the demo message and mints an expected ASN. Packed `ORD-DFW1` is split into labeled `BOX-1` / `BOX-2` so Floor Ship can close one carton while the ticket stays packed. Tracker webhooks mark `ORD-NYC1` in transit, `ORD-CHI1` delivered, and `ORD-MIA1` failed so Traffic can prefer those over the lane estimate. `ASN-DEMO1` already has vendor cartons so Floor Receive posts one box at a time and Unreceive reverses a dock carton that is not put away.

## Carriers

Owners connect shipping accounts on **Setup → Carriers**. The catalog matches how ShipStation, ShipHero, and EasyPost present BYO accounts: pick a provider, paste credentials, test, enable services, set a default, and save a warehouse ship-from.

1. **Direct** — UPS, FedEx, USPS, DHL with your account number and API key / secret / meter.
2. **Aggregator** — EasyPost or ShipEngine with one API key. Demo mode unlocks UPS, FedEx, USPS, and DHL services under that connection.
3. **Rackline Ground** — always available. Cannot be disconnected.

**Enable demo carriers** seeds Northwind-style UPS (`A1B2C3`) and USPS accounts plus Rackline Ground. Demo never calls a carrier. A live EasyPost, ShipEngine, UPS, FedEx, USPS, or DHL account pings on Test, shops live rates, and purchases postage on Buy label. FedEx keeps the client secret in the meter number field. USPS sends the API key as a bearer token. Paste a tracking number to skip the live buy. Void refunds the live label until ship.

Office Orders and Floor Ship load enabled services, parcel dims, **Shop rates**, **Buy label**, and **Void** (blocked after ship). Tracking URLs point at the carrier's public tracker.

## Inventory rules

All quantity changes go through one engine (`src/domain/inventory.ts`) and an append-only movement ledger.

- **Receive** adds qty to a location (blank receipt, purchase order, or customer return). Lines track received vs expected; posting more than remaining returns HTTP 409 (`OVER_RECEIVE`); the document stays `receiving` until every unit is in. Return lines choose restock, scrap, or hold; scrap writes receive then scrap in one persist so on-hand is unchanged; hold opens a QC lock on the bay SKU after receive; unknown disposition is HTTP 400
- **Move / transfer** decrements the from bin and increments the to bin in one ledger movement. Lines track moved vs expected; posting more than remaining returns HTTP 409 (`OVER_MOVE`); the document stays `in_progress` until every unit is moved. Dock, ship, and bench stock get a suggested bulk/storage bay (same idea as directed pick). Moves cannot steal qty reserved for an open pick
- **Pick** decrements the pick bin. Starting pick reserves remaining qty against ATP (on-hand − held − allocated) on location:item. A second start that would oversell returns HTTP 409 (`INSUFFICIENT_ATP`). Lines track picked vs ordered; posting more than remaining returns HTTP 409 (`OVER_PICK`); the document stays `picking` until every unit is picked. The API suggests a pick-face bay that still covers remaining qty for this order. Floor Pick and the order record can open an optional pick map: remaining SKUs are numbered walk stops on the floor plan and 3D racks; tap a stop to set the pick-from bay. Unpick puts unpacked qty back on a bay (`unpick` movement) and restores ATP; posting more than unpacked remaining returns HTTP 409 (`OVER_UNPICK`). Cancel restores all picked qty (including packed), releases allocations, and marks the order `cancelled`. Shipped orders cannot be cancelled.
- **Pick list** prints the directed walk (ATP bay or suggested pick face, aisle → rack → bay → level), remaining qty, FEFO lots, and wave/batch splits
- **Pack** posts packed qty against picked qty. Posting more than remaining returns HTTP 409 (`OVER_PACK`); the document stays `packing` until every picked unit is in the box. Pack does not move the location:item ledger (qty already left at pick). Optional `BOX-n` cartons hold packed units for labels; drop an unshipped box (uncarton) to box those units again
- **Pack slip** prints ordered vs picked vs packed qty from the order record, plus each `BOX-n` barcode and tracking
- **Ship** writes an outbound stamp (qty already left at pick). With cartons, each labeled box can ship on its own; the ticket stays open and allocations stay until every packed unit is in a shipped carton. Orders with no packages still ship the whole ticket. Shopify `fulfillmentCreate` is one fulfillment per shipped carton (or one order-level fulfillment when there are no packages)
- **Adjust** applies a signed delta with a reason
- **Cycle count** snapshots a bin without showing system qty. Every SKU must be entered (0 is a real count); posting more than once is blocked. Empty bays can be confirmed empty. A SKU that was not on the snapshot can be scanned or added; posting still adjusts against *current* on-hand so concurrent movement is not double-applied; Today lists posted counts where counted ≠ system
- **Hold** locks a bay, a SKU in a bay, or a lot. Pick, move, replenish, kit consume, work-order consume, and vendor RTV return HTTP 409 (`HELD_STOCK`). Receive, count, adjust, produce, ship, and scrap still post. FIFO skips held lots when other lots cover the qty. A return received as hold opens a QC lock on the bay SKU (or lot) after the receive
- **Allocate** reserves remaining order qty on pick start against location:item ATP. Pick, move, replenish, kit consume, work-order consume, and vendor RTV return HTTP 409 (`INSUFFICIENT_ATP`) when they would take another order's reservation. Receive, count, adjust, produce, ship, and unpick still post. Leftover reservations release on ship, office/floor cancel, or Shopify cancel. Unpick restores the reservation on the bay the qty returned to.
- **Work order complete** consumes `BOM qty × this-complete qty` from the source location and produces finished goods into the output location. Header `qty_completed` vs qty; posting more than remaining returns HTTP 409 (`OVER_COMPLETE`); the document stays `in_progress` until the header qty is filled. Short components return HTTP 409
- **Kit complete** is the same explode, in one step, with `kit_consume` / `kit_produce` ledger types. Completing a kit or work order writes as-built links from each finished serial/lot to the component lots/serials consumed. Recipe **steps** and SKU **photos** are identification — they do not change qty or gate complete. Upload without the `MEDIA` R2 bucket returns HTTP 409 (`MISSING_MEDIA`)
- **Dekit** reverses a fully completed kit from its as-built rows: consume finished from the output bay, restore components onto the source bay. In-progress kits cannot be dekitted. Status becomes `dekitted`
- **Vendor RTV** decrements the from-bay (`rtv` movement). Lines track returned vs expected; posting more than remaining returns HTTP 409 (`OVER_RETURN`); the document stays `returning` until every unit is shipped back. Holds and ATP apply like pick
- **As-built** is lookup, not a second qty ledger. Floor Lookup scans a serial (`LAMP-1001`) or lot (`LOT-2026-A`) and shows built-from / used-in. The office item, kit, and work-order records show the same links
- **Replenish** moves bulk storage onto a pick face when on-hand is below the SKU's pick min. Tickets track moved vs expected qty; posting more than remaining returns HTTP 409 (`OVER_MOVE`); the document stays `in_progress` until every unit is moved
- **Lots / serials** overlay the location:item balance. Receive requires a vendor lot or matching serials; pick/move FIFO the oldest lot or serial if omitted
- **Shipping label** buys from a connected carrier account (Setup → Carriers). Demo mints `1Z` / `9400` / `FE-` / `DHL-` / `RL-` tracking. Live EasyPost, ShipEngine, UPS, FedEx, USPS, and DHL purchase postage. Void is allowed until ship. Shop rates returns canned quotes unless that connection is live.
- **Print station** scans a bay, SKU, order, or wave. Pick lists queue for open/picking tickets and open waves; pack slips once picking has started; shipping labels once the ticket is picked. Floor **Print** and Setup **Labels** share that queue
- **Reorder point** flags SKUs at or below the threshold on the floor board. **Draft PO** on Today opens a draft purchase for `max(1, ROP − on-hand)` using the last vendor, skipping SKUs already on an open PO
- **Runway** projects days until stockout from a SKU baseline ship rate (or observed velocity). Cover is sellable qty plus dated inbound, minus BOM burn and lots that expire before they would ship. **Draft PO** on Analytics → Runway orders lead time + 14 days of burn for order-today SKUs
- **Promise** quotes when an open order, or a new qty of a SKU, leaves on the carrier cutoff. Shelf, queue, live pace, and dated inbound (ASN / ordered PO) decide the day. Lots that expire before that pickup do not count. The quote does not allocate — pick start still owns ATP. `GET /api/analytics/promises/ask` returns the same JSON a buying agent would read (`reservesStock: false`)
- **Zone** tags bays on a warehouse for wave scoping. Qty stays on location:item
- **Wave / batch** groups open orders. Batch release consolidates remaining SKU qty; floor batch-pick posts picks across those orders and returns HTTP 409 (`OVER_BATCH_PICK`) when over. Qty stays integer pieces on location:item
- **ASN** is a vendor advance notice that receives like a purchase (partial qty, over-receive 409). Vendor `BOX-n` / SSCC cartons receive one at a time onto the dock. Unreceive reverses dock qty for a carton that is not put away (`unreceive` movement) and reopens the ASN. Put-away cartons cannot be unreceived (409 `ALREADY_PUTAWAY`)
- **3PL client** tags documents (orders, ASNs, waves). Inventory is not split by client on the ledger
- **Yard visit** tracks a trailer from expected → checked in → at dock → checked out
- **Labor** scores staff from the movement ledger and pack events (lines, units, difficulty-adjusted pace 0–10, exceptions). Performance is owner-only; operators see My day on the floor. Seeded receive (`refType=seed`) and non-members are excluded. Pack posts `pack_events` because pack does not move location:item qty
- **Equipment** registers powered industrial trucks. Exclusive checkout records who had the machine on a shift or WMS document. Pre-use inspection is required; a fail marks the truck out of service (`INSPECTION_FAILED`). Missing or expired class certs return HTTP 409 (`CERT_REQUIRED` / `CERT_EXPIRED`). A second checkout on the same truck or operator returns HTTP 409 (`EQUIPMENT_IN_USE` / `OPERATOR_CHECKED_OUT`). Pick and putaway still run without a truck; if the operator is checked out, the ledger stamps `equipment_id`
- **Multi-warehouse** lets owners add buildings; transfers may target another warehouse (`toWarehouseId`) and scan-to-move may cross buildings

## Roles

- `owner` — full catalog, including deletes, Shopify credentials, clients, zones, extra warehouses, and Setup → Audit
- `operator` — floor actions (receive, ASN, transfer, pick, wave batch-pick, unpick, cancel, ship, complete WO, kit, dekit, vendor RTV, cycle count, hold, yard, equipment checkout, adjust) and Shopify order simulation. Cannot delete items, locations, or BOMs

Signup creates an organization plus a default **Main warehouse**. Forgot password is on `/login`. Team invite emails a set-password link when `MAIL_API_KEY` and `MAIL_FROM` are set; otherwise the owner still types a starter password.
