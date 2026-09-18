# Rackline WMS

Cloudflare-native warehouse management for makers who grow into manufacturers. Iteration 1 covers organization tenancy, inventory in locations, inbound receipts, outbound pick/ship, cycle-count adjustments, BOMs, and work orders.

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
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM, bins `RECV` / `A-01-01` / `PROD` / `SHIP`, an open receipt, order, and work order.

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
- **Pick** decrements the pick bin
- **Ship** writes an outbound movement (qty already left at pick)
- **Adjust** applies a signed delta with a reason
- **Work order complete** consumes `BOM qty × WO qty` from the source location and produces finished goods into the output location. Short components return HTTP 409.

## Roles

- `owner` — full catalog, including deletes
- `operator` — floor actions (receive, pick, ship, complete WO, adjust). Cannot delete items, locations, or BOMs

Signup creates an organization plus a default **Main warehouse**.
