# Rackline WMS

Cloudflare-native warehouse management for makers who grow into manufacturers.

The public site is a marketing landing page. After sign-in, the floor board, rack map, scan-to-move, Shopify channel, and classic WMS loops run in a shadcn/ui shell (from `shadcn-dashboard-landing-v1/vite-version`).

Iteration 1 covers organization tenancy, inventory in locations, inbound receipts, outbound pick/ship, adjustments, BOMs, and work orders.

Iteration 2 adds bin-to-bin transfers (putaway), cycle counts, the inventory ledger, reorder points / low stock, and document line visibility.

Iteration 3 fills the parked Purchases and Returns slots: vendor POs with partial receive onto the dock, and customer RMAs that receive stock back into a bay.

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
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM, dock / aisle A (two racks, two levels) / aisle B / shop / outbound, reorder points, an open receipt, purchase order `PO-DEMO1` (Harbor Components), return `RMA-DEMO1` (Harbor Workshop), a floor order, Shopify order `#1004` (Maya Chen), and a work order. Then open **Map** and **Move**.

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

- **Receive** adds qty to a location (blank receipt, purchase order, or customer return)
- **Move / transfer** decrements the from bin and increments the to bin in one ledger movement
- **Pick** decrements the pick bin
- **Ship** writes an outbound movement (qty already left at pick) and, for Shopify orders, creates a fulfillment
- **Adjust** applies a signed delta with a reason
- **Cycle count** snapshots a bin, then posts variances against *current* on-hand so concurrent movement is not double-applied
- **Work order complete** consumes `BOM qty × WO qty` from the source location and produces finished goods into the output location. Short components return HTTP 409
- **Reorder point** flags SKUs at or below the threshold on the floor board

## Roles

- `owner` — full catalog, including deletes, and Shopify credentials
- `operator` — floor actions (receive, transfer, pick, ship, complete WO, cycle count, adjust) and Shopify order simulation. Cannot delete items, locations, or BOMs

Signup creates an organization plus a default **Main warehouse**.
