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

## Packaging checklist (engineering)

- [x] OAuth install callback
- [x] Webhooks orders create/update/paid/cancelled
- [x] Sellable `inventorySetQuantities`
- [x] `fulfillmentCreate` per carton
- [ ] Public App Store listing assets (icon, screenshots of Garage Mode + Floor)
- [ ] GDPR / customer data request webhooks (when listing goes public)
- [ ] App review notes: Garage Mode default, Northwind demo credentials for reviewers

Partner later: Prediko (AI demand) as complementary — Rackline stays execution.
