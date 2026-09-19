# Rackline WMS

Cloudflare-native warehouse management for makers who grow into manufacturers.

Iteration 1 covers organization tenancy, inventory in locations, inbound receipts, outbound pick/ship, cycle-count adjustments, BOMs, and work orders. Locations sit on a rack-and-area map (floor plan and 3D), and slots can be moved by scanning the old bay barcode then the new one.

Iteration 2 adds bin-to-bin transfers (putaway), cycle counts, the inventory ledger, reorder points / low stock, and document line visibility.

Shopify checkouts land as pick tickets; after ship, Rackline posts fulfillment back to Shopify.

## Stack

- Cloudflare Workers + [Hono](https://hono.dev) API
- D1 (SQLite) + Drizzle
- Vite + React + Tailwind UI, served as Workers static assets
- Better Auth email/password
- Shopify Admin GraphQL + HMAC-signed webhooks

## Local development

```bash
npm install
npx wrangler d1 migrations apply rackline --local
npm test
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

If you already seeded the original four-bin demo, delete `.wrangler` and seed again so the mapped racks are created.

On the sign-in screen, either:

- Create an organization, or
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM, a mapped floor with dock / aisle A / aisle B / shop / outbound, reorder points, an open receipt, a floor order, Shopify order `#1004` (Maya Chen), and a work order.

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

- **Receive** adds qty to a location
- **Move** transfers a whole slot (or selected SKUs) from one bay to another via barcode scan
- **Transfer** is a draft putaway document; posting decrements the from bin and increments the to bin in one ledger movement
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

## Map and scanners

Each location has a barcode (defaults to the location code), an aisle / rack / bay / level address, and XYZ coordinates on the warehouse map.

- **Map** shows a floor plan and a 3D rack view. Occupied storage bays are amber. Click a bay to see on-hand and its printable barcode. Owners can drag a bay on the floor plan to match the real building.
- **Move** is built for gun scanners: scan the previous location barcode, then the new one. All on-hand in that slot transfers with no quantity typing. You can also tap bays on the 3D map or use the camera (Chromium `BarcodeDetector`).
- USB / Bluetooth HID scanners work on every screen. Camera scanning is on the sidebar **Scan** control and on Move / Map.
