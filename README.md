# Rackline WMS

Cloudflare-native warehouse management for makers who grow into manufacturers.

Iteration 1 covers organization tenancy, inventory in locations, inbound receipts, outbound pick/ship, adjustments, BOMs, and work orders.

Iteration 2 adds bin-to-bin transfers (putaway), cycle counts, the inventory ledger, reorder points / low stock, and document line visibility.

## Stack

- Cloudflare Workers + [Hono](https://hono.dev) API
- D1 (SQLite) + Drizzle
- Vite + React + Tailwind UI, served as Workers static assets
- Better Auth email/password

## Local development

```bash
npm install
npx wrangler d1 migrations apply rackline --local
npm test
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

On the sign-in screen, either:

- Create an organization, or
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM, bins `RECV` / `A-01-01` / `PROD` / `SHIP`, reorder points, an open receipt, order, and work order.

`wrangler.jsonc` uses a placeholder `database_id`. Local D1 does not need a Cloudflare account. When you are ready to deploy:

```bash
npx wrangler d1 create rackline
# paste the returned database_id into wrangler.jsonc
npx wrangler d1 migrations apply rackline --remote
npm run deploy
```

Set a real `BETTER_AUTH_SECRET` (32+ characters) and `BETTER_AUTH_URL` before production.

## Inventory rules

All quantity changes go through one engine (`src/domain/inventory.ts`) and an append-only movement ledger.

- **Receive** adds qty to a location
- **Move / transfer** decrements the from bin and increments the to bin in one ledger movement
- **Pick** decrements the pick bin
- **Ship** writes an outbound movement (qty already left at pick)
- **Adjust** applies a signed delta with a reason
- **Cycle count** snapshots a bin, then posts variances against *current* on-hand so concurrent movement is not double-applied
- **Work order complete** consumes `BOM qty × WO qty` from the source location and produces finished goods into the output location. Short components return HTTP 409
- **Reorder point** flags SKUs at or below the threshold on the floor board

## Roles

- `owner` — full catalog, including deletes
- `operator` — floor actions (receive, transfer, pick, ship, complete WO, cycle count, adjust). Cannot delete items, locations, or BOMs

Signup creates an organization plus a default **Main warehouse**.
