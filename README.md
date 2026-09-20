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

Iteration 11 reserves ATP when pick starts: location:item allocations (on-hand − held − allocated). A second order that would oversell returns HTTP 409 (`INSUFFICIENT_ATP`). Create and Shopify ingest stay promises until start. Leftover reservations release on ship or Shopify cancel.

Iteration 12 lets a cycle count take an unexpected SKU: scan or add a catalog item that was not on the bay snapshot. Posting still adjusts against current on-hand, so a found SKU with system 0 becomes a +variance.

Iteration 13 adds catch-weight as an overlay on the location:item ledger: flag a SKU, enter grams on receive / pick / count, copy that weight onto ship, and show it on the document and ledger. Qty stays integer pieces. No dual UoM, no catch-weight ATP.

Iteration 14 adds lot expiry / FEFO: flag a SKU, enter a calendar date on receive, pick the earliest unexpired lot first, skip expired stock, and list expiring lots on Today. Qty stays integer pieces on location:item.

Iteration 15 records as-built genealogy when a kit or work order completes: each finished serial/lot is linked to the component lots and serials consumed. Floor Lookup scans a serial or lot. Qty stays integer pieces on location:item.

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
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM, dock / aisle A (two racks, two levels) / aisle B / shop / outbound, reorder points, an open receipt `RCP-DEMO1` (12× LED-BULB + 6× SHADE — partial receive is allowed), purchase order `PO-DEMO1` (Harbor Components), return `RMA-DEMO1` (Harbor Workshop), a floor order, Shopify order `#1004` (Maya Chen), a work order, and kit `KIT-DEMO1`. LED-BULB is lot-tracked (`LOT-2026-A` / `LOT-2026-B`) with pick min 20 on `A-01-02`; LAMP is serial-tracked (`LAMP-1001`–`LAMP-1014`) with pick min 12 on `B-01-01`; RESIN is catch-weight (6 bottles / 3000 g on `A-01-01`); GLUE is lot + expiry (`LOT-OLD` / `LOT-NEW` on `A-01-01`, expired `LOT-DEAD` on `A-01-03`). `LAMP-1001` is seeded with as-built component lots. Then open **Map** and **Move**.

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

## Inventory rules

All quantity changes go through one engine (`src/domain/inventory.ts`) and an append-only movement ledger.

- **Receive** adds qty to a location (blank receipt, purchase order, or customer return). Lines track received vs expected; posting more than remaining returns HTTP 409 (`OVER_RECEIVE`); the document stays `receiving` until every unit is in
- **Move / transfer** decrements the from bin and increments the to bin in one ledger movement. Dock, ship, and bench stock get a suggested bulk/storage bay (same idea as directed pick). Moves cannot steal qty reserved for an open pick
- **Pick** decrements the pick bin. Starting pick reserves remaining qty against ATP (on-hand − held − allocated) on location:item. A second start that would oversell returns HTTP 409 (`INSUFFICIENT_ATP`). Lines track picked vs ordered; posting more than remaining returns HTTP 409 (`OVER_PICK`); the document stays `picking` until every unit is picked. The API suggests a pick-face bay that still covers remaining qty for this order
- **Pack slip** prints ordered vs picked qty from the order record
- **Ship** writes an outbound movement (qty already left at pick), releases leftover allocations, and, for Shopify orders, creates a fulfillment
- **Adjust** applies a signed delta with a reason
- **Cycle count** snapshots a bin without showing system qty. Every SKU must be entered (0 is a real count); posting more than once is blocked. Empty bays can be confirmed empty. A SKU that was not on the snapshot can be scanned or added; posting still adjusts against *current* on-hand so concurrent movement is not double-applied; Today lists posted counts where counted ≠ system
- **Hold** locks a bay, a SKU in a bay, or a lot. Pick, move, replenish, kit consume, and work-order consume return HTTP 409 (`HELD_STOCK`). Receive, count, adjust, produce, and ship still post. FIFO skips held lots when other lots cover the qty
- **Allocate** reserves remaining order qty on pick start against location:item ATP. Pick, move, replenish, kit consume, and work-order consume return HTTP 409 (`INSUFFICIENT_ATP`) when they would take another order's reservation. Receive, count, adjust, produce, and ship still post
- **Work order complete** consumes `BOM qty × WO qty` from the source location and produces finished goods into the output location. Short components return HTTP 409
- **Kit complete** is the same explode, in one step, with `kit_consume` / `kit_produce` ledger types. Completing a kit or work order writes as-built links from each finished serial/lot to the component lots/serials consumed
- **As-built** is lookup, not a second qty ledger. Floor Lookup scans a serial (`LAMP-1001`) or lot (`LOT-2026-A`) and shows built-from / used-in. The office item, kit, and work-order records show the same links
- **Replenish** moves bulk storage onto a pick face when on-hand is below the SKU's pick min
- **Lots / serials** overlay the location:item balance. Receive requires a vendor lot or matching serials; pick/move FIFO the oldest lot or serial if omitted
- **Shipping label** mints `RL-` tracking (Rackline Ground / UPS Ground / USPS Priority) and prints from the order
- **Print station** scans a bay, SKU, or order. Pack slips queue once picking has started; shipping labels once the ticket is picked. Floor **Print** and Setup **Labels** share that queue
- **Reorder point** flags SKUs at or below the threshold on the floor board

## Roles

- `owner` — full catalog, including deletes, and Shopify credentials
- `operator` — floor actions (receive, transfer, pick, ship, complete WO, cycle count, hold, adjust) and Shopify order simulation. Cannot delete items, locations, or BOMs

Signup creates an organization plus a default **Main warehouse**.
