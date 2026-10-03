# Shopify App Store packaging + Stocky replacement

## Positioning

**Rackline WMS** is the Shopify WMS for small manufacturers — not just sellers. Stocky stopped on **August 31, 2026**. Merchants who need POs, reorder, and stocktakes *plus* bin-level warehouse execution land here.

Public LP: `/use-cases/stocky-replacement` and `/use-cases/shopify-wms`.

## App Store listing draft

| Field | Copy |
|---|---|
| **Name** | Rackline WMS |
| **Tagline** | Warehouse software for makers who grow into manufacturers |
| **Category** | Orders and shipping / Inventory |
| **Highlights** | Garage Mode → full warehouse; checkout → pick ticket; sellable qty push; kits/BOMs; FEFO; Promise leave-by; Stocky-class PO/reorder/counts |
| **Pricing** | Self-serve Garage; Shop / Manufacturer plans (see site) |

## Required Admin scopes (already in README)

`read_orders`, `write_orders`, fulfillment-order scopes, `read_inventory`, `write_inventory`, `read_locations`, `read_products`.

## Install path

1. Owner opens Setup → Shopify
2. OAuth when `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` are set, or paste Admin token
3. Pick Shopify location for sellable sync
4. Demo mode until live token is confirmed

## Stocky migration checklist (merchant-facing)

1. Export Stocky POs / stocktakes while read-only window lasts
2. Rebuild suppliers as Rackline vendors on Items / Purchases
3. Set reorder points (or baseline ship rates for Runway)
4. Use Today → Draft PO and Analytics → Runway → Draft PO
5. Run blind cycle counts on the Floor
6. Connect Shopify OAuth and push sellable qty

## Listing assets

Capture these from the Northwind demo (desktop and a phone width) and attach them in the Partner Dashboard. The app does not generate the image files.

1. Garage Ship queue with a ready order and the Ship button.
2. Getting started, the short first-hour menu (Ship, Items, Receive).
3. Floor Next job, with the scan box and the bay.
4. A recipe or kit with the SKU photo.
5. Promise, one order that leaves today.

Icon: the Rackline mark on a square, at least 1200×1200. Name the listing **Rackline WMS**.

## Reviewer notes

- New organizations start in Garage Mode. The sidebar stays on Ship, Items, and Receive until Getting started is done. The rest of the bench is in the command palette (⌘K).
- Reviewer login: **Load Northwind Makers demo** on `/login` — `demo@northwind.makers` / `rackline-demo`. Northwind is already a full warehouse, so the reviewer sees Manufacturer as well as the ship queue.
- Demo mode never calls Shopify. Paste a shop domain or use **Install Shopify app** when `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are set.
- GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) use the same HMAC endpoint as order webhooks, `/api/shopify/webhooks`. A data request is acknowledged. A customer redact clears ship-to and the customer record. A shop redact removes the connection and the shopper fields on that shop's orders. Stock movements stay.
- Promise on a product page is the snippet on Setup → Shopify. `GET /api/shopify/promise` answers with one sentence and `reservesStock: false`.

## Packaging checklist (engineering)

- [x] OAuth install callback
- [x] Webhooks orders create/update/paid/cancelled
- [x] Sellable `inventorySetQuantities`
- [x] `fulfillmentCreate` per carton
- [x] GDPR webhooks on `/api/shopify/webhooks`
- [x] Reviewer path: Northwind demo, Garage default for new orgs, Promise snippet
- [ ] Partner Dashboard upload: icon and the five screenshots above (captured from the running demo)

Partner later: Prediko (AI demand) as complementary — Rackline stays execution.
