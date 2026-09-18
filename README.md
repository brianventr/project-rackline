# Rackline WMS

Cloudflare-native warehouse management for makers who grow into manufacturers. Iteration 1 covers organization tenancy, inventory in locations, inbound receipts, outbound pick/ship, cycle-count adjustments, BOMs, and work orders. Locations sit on a rack-and-area map (floor plan and 3D), and slots can be moved by scanning the old bay barcode then the new one.

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

If you already seeded the original four-bin demo, delete `.wrangler` and seed again so the mapped racks are created.

On the sign-in screen, either:

- Create an organization, or
- Click **Load Northwind Makers demo** (`demo@northwind.makers` / `rackline-demo`) to get a stocked shop: Desk Lamp BOM, a mapped floor with dock / aisle A / aisle B / shop / outbound, an open receipt, order, and work order.

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
- **Move** transfers a whole slot (or selected SKUs) from one bay to another via barcode scan
- **Pick** decrements the pick bin
- **Ship** writes an outbound movement (qty already left at pick)
- **Adjust** applies a signed delta with a reason
- **Work order complete** consumes `BOM qty × WO qty` from the source location and produces finished goods into the output location. Short components return HTTP 409.

## Roles

- `owner` — full catalog, including deletes
- `operator` — floor actions (receive, pick, ship, complete WO, adjust). Cannot delete items, locations, or BOMs

Signup creates an organization plus a default **Main warehouse**.

## Map and scanners

Each location has a barcode (defaults to the location code), an aisle / rack / bay / level address, and XYZ coordinates on the warehouse map.

- **Map** shows a floor plan and a 3D rack view. Occupied storage bays are amber. Click a bay to see on-hand and its printable barcode. Owners can drag a bay on the floor plan to match the real building.
- **Move** is built for gun scanners: scan the previous location barcode, then the new one. All on-hand in that slot transfers with no quantity typing. You can also tap bays on the 3D map or use the camera (Chromium `BarcodeDetector`).
- USB / Bluetooth HID scanners work on every screen. Camera scanning is on the sidebar **Scan** control and on Move / Map.
