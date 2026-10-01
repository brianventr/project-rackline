# How Rackline works: Garage and Manufacturer

This guide is for the owner. It explains how an order gets from a store to a customer's door, how each part of the app behaves today, and what changes between the two operating modes. For the one-minute version inside the app, open the tour (sliders icon in the top bar → **How Rackline works**, or ⌘K → "How Rackline works"). For single words, type a term with a question mark in the command palette to read the glossary.

Rackline has two modes. The internal value for the second one is `warehouse`; on screen it is called **Manufacturer**.

- **Garage** is a shipping app. Store orders land in one queue, and one click picks, packs, buys the label, ships, and sends tracking back to the store.
- **Manufacturer** is a warehouse system. Orders are waved by carrier cutoff, picked and packed by scan on the floor, then shipped.

Both modes run on the same ledger. Every item, bay, order, and movement is the same record in either mode. The mode changes which screens you see and how an order is allowed to move out.

## 1. Setting up

Most of this is the same in both modes. New organizations start in Garage.

### Deployment (one time)

1. Set `BETTER_AUTH_SECRET` as a Wrangler secret, 32 characters or more. Sign-in needs it, and it is also the key that seals stored credentials: WooCommerce and Etsy keys, the Shopify Admin token and webhook secret, and carrier API keys, secrets, and tracker webhook secrets (the FedEx client secret lives in the meter number field). A deployed Worker without it refuses to store them.
2. Optional: set `MAIL_API_KEY` and `MAIL_FROM` for purchase-order email, password resets, and teammate invites.
3. Optional: set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` to allow **Install Shopify app** (OAuth). Pasting an Admin token works without them.
4. Optional: set `ETSY_API_KEY` (your Etsy app keystring) to allow a live Etsy connection. `ETSY_SHARED_SECRET` is optional. In your Etsy app, register the callback `https://<your-domain>/api/channels/etsy/oauth/callback`.
5. The Worker runs a scheduled pull every 15 minutes (`*/15 * * * *` in `wrangler.jsonc`). That is how Etsy orders arrive, and it backstops WooCommerce.

### In the app

1. **Sign up.** You get an organization in Garage and one building.
2. **Getting started** on Today (owners) walks four required steps: add a SKU, set up your building, receive stock, and ship an order. In Garage, the ship step opens the Ship queue; in Manufacturer, it opens a new order. Optional steps are a store, a carrier, and a teammate.
3. **Set up your building** (`/welcome`) builds a dock, a rack of bays, a bench, and an outbound bay, then draws the map.
4. **Get to one-click shipping** is the checklist at the top of the Ship queue in Garage. It has four steps, and each one opens the page that fixes it:
   - Connect a store (Settings → Integrations)
   - Connect a carrier other than Rackline Ground (Settings → Carriers)
   - Set your ship-from address (Settings → Warehouse)
   - Add your usual box (the **Boxes** sheet on the Ship queue)

   The card disappears once all four are done. Its store and carrier steps are the same checks as the optional steps in Getting started, so they tick off together in both places. A store is Shopify or any active Etsy, WooCommerce, or Faire channel, live or by CSV. An empty queue offers **New order**, so you can ship one by hand before a store is connected.
5. **Ship weights.** On each SKU (Stock → Items), enter a ship weight in ounces, and optionally length, width and height. The Ship queue uses these to weigh every parcel.
6. **Carrier.** On Settings → Carriers, connect UPS, FedEx, USPS, DHL, EasyPost, or ShipEngine. Enable services and **Set as default**. Rackline Ground is always there for testing. Then pick the building's **Default service** on Settings → Warehouse, or with **Save as default** next to the Ship queue's service picker.
7. **Manufacturer only:** add zones (Settings → Zones), set carrier cutoffs (the **Cutoffs** button on Outbound → Waves), and add 3PL clients if you hold stock for other brands.

## 2. How an order moves, end to end

### Orders come in

1. **Shopify.** Checkout reaches Rackline through signed webhooks (`orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`). A repeat delivery with the same webhook id is ignored. Unknown SKUs are created as finished goods. Cancelling in Shopify cancels the ticket and restores stock.
2. **WooCommerce.** Paste the store URL and a consumer key and secret on Settings → Channels. Rackline checks the keys, seals them, and tries to register an order webhook for you. If the key cannot write webhooks, the page shows the URL to add by hand. Only `processing` orders become tickets. The 15-minute pull also picks up anything a webhook missed.
3. **Etsy.** **Connect Etsy shop** signs in with Etsy. Paid, unshipped receipts are pulled every 15 minutes. The first pull looks back 14 days, and each later pull overlaps the last one by an hour so nothing slips through.
4. **Faire, and Etsy by file.** Paste a CSV export on Settings → Channels. Unknown SKUs are reported, not created; add them and paste again.
5. **By hand.** Create an order on Outbound → Orders. Crowdfunding CSVs (BackerKit, Gamefound, Kickstarter-style) come in through Settings → Imports.

Every channel lands orders in the same shape, so everything after this point works the same for every channel. Each order is keyed on its channel and the channel's order id. A second webhook, a pull that overlaps, or a re-pasted CSV returns the existing order instead of making a duplicate.

An order that arrives soft-reserves ATP for what is on the shelf. The leave-by on Promise stays a quote. Pick start pins the reserve to a bay.

### Receiving

1. Draft a purchase order (Today's reorder queue and Runway can draft one for you), then **Send & mark ordered**.
2. Receive on Inbound → Receipts or Floor → Receive. Partial receive is fine; the document stays open until every unit is in. More than was expected is refused (`OVER_RECEIVE`).
3. Put stock away. Rackline suggests a bay for each SKU (Floor → Put away).
4. Manufacturer adds ASNs (vendor advance notices, with vendor cartons received one box at a time), the yard (trailers checked in to a dock), and EDI 856 notices that turn into ASNs.

### Pick, pack, ship

In **Garage**, this is one button on the Ship queue:

1. Rackline plans the pick from the suggested bays. Lots go first-expiring first, and serials go first-in.
2. It posts the picks and packs every unit.
3. It buys the label from the chosen service and marks the order shipped.
4. It posts tracking back to the store.

In **Manufacturer**, it is a floor flow:

1. Group orders into a wave from the wave planner, or pick orders one at a time.
2. **Floor → Pick** or **Floor → Wave** (batch pick). The operator scans the bay and each SKU once, then types the qty, before the post is accepted.
3. **Floor → Pack.** The operator scans every unit into the box; each scan adds one. Boxes (`BOX-1`, `BOX-2`) are optional; once one exists, every packed unit has to be in a labeled box before ship.
4. **Floor → Ship** or the order page. Buy the label, or paste a tracking number, then ship. The service starts on the order's own, then the building's default. With boxes, each labeled box can ship on its own.

### Tracking goes back

1. **Shopify** gets one `fulfillmentCreate` per shipped box, or one for the whole order when there are no boxes. If it fails, **Retry Shopify** is on the order's menu.
2. **WooCommerce** is marked completed with the tracking number, and **Etsy** gets tracking on the receipt. This happens when the order is fully shipped. If it fails, the order still counts as shipped in Rackline, the error is saved on the order, and **Retry WooCommerce tracking** or **Retry Etsy tracking** appears on its menu.
3. **Faire orders, and Etsy orders while Etsy is connected only by CSV,** do not post back. Mark them shipped in the channel. An Etsy order shipped without a live connection shows **Manual** under Tracking post-back, with "Mark it shipped in Etsy." and no retry, and it does not count as a failed post-back on Settings → Channels. The ship toast lists these orders too. Once Etsy is connected live, orders imported by CSV post tracking like any other.
4. **Carrier tracking.** EasyPost and ShipEngine tracker webhooks move orders through at gate, in flight, and arrived on Traffic. Failures show as exceptions on Today, where you can buy a replacement label. Each live account has its own URL (`/api/carriers/trackers/webhooks/<connection id>`), and Rackline checks that account's secret instead of every account. The older shared URL still works when the tracking number belongs to one live account. Shopify webhook secrets and tracker webhook secrets are sealed at rest; a secret saved before sealing still verifies, and is sealed the next time it is read.

## 3. Garage: simple on the surface, full ledger underneath

Garage is built to feel like ShipStation. There is one queue, one button, and a batch of labels to print. The parts underneath (reservations, the directed pick, lots, serials, the movement ledger) are the same ones the full warehouse uses.

### Ship queue is home

Everyone in Garage lands on **Ship** (`/ship`) after sign-in, owners and operators alike. The queue shows every order for the building with channel, ship-to, items, parcel weight, service, and age. It has three tabs:

- **Ready to ship.** Rackline has checked that it can pick, pack, and label the order without help.
- **Needs attention.** The row says why, with a link to open the order.
- **Shipped.** Orders from the last seven days, with tracking links.

You can search by order, customer, city, or SKU, and export to CSV.

### One click, or a whole batch

**Ship** on a row, or select rows and **Create labels & ship**, runs pick → pack → label → ship → post-back for each order. Bulk runs take up to 50 orders. Each order is handled on its own, so one failure does not stop the rest. You get a count of shipped and failed orders and the first error. Shipped orders open the batch label page.

Rackline buys the label last, once the picks and the pack have gone through, because postage is the one step that costs money and is hard to take back. Before any stock moves, it checks what it can without calling the carrier: the service is enabled, a live account has its API key, both addresses have a street, city, region, and postal code, and you are allowed to pick, pack, and ship.

If any step fails after that, Rackline undoes the whole run. It voids a label it bought, puts the picked units back in the bays they came from, unpacks what it packed, and returns the order's status, reservations, service, and parcel size to where they were. The message names what failed and ends with "The order is back where it started", so **Ship** again starts clean. If an undo step itself fails (the carrier refuses the void, say), the message says what to do by hand. If the ship went through and only a later step errored, the order counts as shipped.

The queue sends these orders to **Needs attention** instead of guessing:

- Orders already split into boxes. Label and ship each box from the order page.
- Catch-weight SKUs. Weigh them on Floor → Pick first.
- Not enough free stock.
- Orders that are cancelled or already shipped.
- A missing ship weight, when the service buys live postage (`NEED_WEIGHT`).
- A ship-to address that fails the address check (`ADDRESS_INVALID`). The row offers the ways past it (see Address checks).
- An international order with an item that has no customs details (`CUSTOMS_REQUIRED`). **Add customs** on the row opens the item.

### Boxes, weights, and service

- **Box presets.** The **Boxes** sheet (owners) saves your usual boxes: name, outside and inside size in inches, and empty and max weight in ounces. The first box you add becomes the default, and you can switch the default at any time.
- **Box.** A box picked in the toolbar applies to this run. Otherwise the box of the shipping rule that matched wins, then the smallest saved box the items fit (see Automatic box), then the default box.
- **Parcel weight.** A weight typed or read off the scale at Scan to ship wins, then a weight typed on the order. Otherwise it is each SKU's ship weight × qty, plus the chosen box's empty weight.
- **Parcel size.** A size typed on the order wins, then the chosen box, then the SKU's own size when the order is a single unit. A row with no ship weight shows **Add weight**, which links to Items.
- **Service.** The toolbar's service picker applies to this run, and owners can press **Save as default** beside it to make that service the building's default. Otherwise the matched rule's service or rate choice wins, then the order's own service, then the building's rate choice (Settings → Warehouse). With rate choice left on **Default service**, that is the building's default service, then the first enabled service on your default carrier, with Rackline Ground as the last fallback. An order's or building's service whose carrier is disconnected, or that is turned off, is skipped. A rule's is not: the rule holds its orders instead (`SHIP_RULE_SERVICE`).

### Printing

**Print labels** (after a run, or from selected shipped rows) opens every label on one page (`/ship/labels`). **Print all** opens a single browser print. If this workstation has a thermal printer bound for shipping labels (Settings → Printers), it sends one job per label instead.

### Shipping rules

**Settings → Shipping rules** (owners) is an ordered list of rules that choose the box and service for an order before quick-ship runs. The Ship queue and the Shipping group on Integrations link to it.

- **When.** A rule matches on any mix of: SKUs on the order, parcel weight (from and to, in ounces), how many different SKUs, how many units, ship-to country, state or province, postal code prefix, and sales channel (Shopify, Etsy, WooCommerce, Faire, Manual, Crowdfunding). Every condition you fill in has to match, and a list matches when any entry does. A rule with no conditions matches every order, which makes it a good last rule.
- **Then.** Use a box, use a service or a rate choice (see Rate choice), or hold the order for review. A rule can do one of these or several.
- **Order.** Rules are checked top to bottom, and the first enabled rule that matches wins. The arrows on each row move it. A rule runs in every building, or in just one.

The weight a rule sees is the weight typed on the order, or read off the scale at the station. Otherwise it is the SKUs' ship weights added up, without the box. If a SKU has no ship weight, weight conditions do not match.

What wins, for every order:

- **Box.** A box picked in the toolbar, then the rule's box, then the smallest box the items fit (see Automatic box), then the default box.
- **Service.** A service picked in the toolbar, then the rule's service or rate choice, then the order's own service, then the building's rate choice.

The queue says why on every row. Under the box and the service it shows **Rule: Small parcels**, **Auto**, **Default box**, **Cheapest**, and so on. Quick-ship saves the same words on the order as its ship reason, for example `Mailer (Rule: Small parcels) · UPS Ground (Cheapest)`, and the Shipped tab shows it next to the postage. **Ship** on a row, **Create labels & ship**, and Scan to ship all ask the same question, so they get the same answer.

**Hold for review** sends matching orders to **Needs attention** with the rule's name, and bulk ship leaves them out (`SHIP_RULE_HOLD`). Once someone has looked, **Ship anyway** on the row or at the station, or **Ship** on the order page, ships it. A rule whose service no connected carrier account offers holds its orders too (`SHIP_RULE_SERVICE`), until you edit the rule or turn the service back on in Settings → Carriers.

Rules only steer quick-ship. In Manufacturer they wait, and labels bought on the order page or on Floor → Ship use the box and service picked there.

### Rate choice

Each building has a **Rate choice** on Settings → Warehouse, under its default service. A rule can name one too.

- **Default service.** The building's default service. New buildings start here.
- **Cheapest.** The lowest price, then the earliest arrival.
- **Fastest.** The earliest arrival, then the lowest price. Arrival is the carrier's next pickup after its cutoff, plus its transit days, counted in working days.
- **Cheapest on time.** The cheapest quote that arrives by the promise date: the day the order came in, plus the building's **Delivery promise** in working days. If nothing arrives in time, it takes the fastest, and the row says nothing arrives by that day. With no delivery promise set, it takes the cheapest.

A rate choice applies only when nothing more specific names a service: not the toolbar, not a rule's own service, and not the order's own service.

Cheapest, fastest, and on time ask every connected carrier account for rates on the order's parcel, with at most four carrier calls at once. An account that has not answered in 8 seconds is skipped. A quote is kept for 10 minutes for the same order, parcel, and addresses, so the queue, the station, and the ship that follows agree on the price. Once a carrier account other than Rackline Ground is connected, Rackline Ground is never chosen, so an account that fails to quote never turns into a demo label.

The queue prices the 25 oldest orders that are ready to ship and shows the chosen service and price on each. The rest say **Quoted when shipped**. Quick-ship records the price on the order and its label. When no account returns a rate, the order waits under **Needs attention** (`NO_RATE`). Like rules, a rate choice only steers quick-ship, so it waits in Manufacturer.

### Automatic box

When you have more than one saved box, quick-ship packs each order in the smallest box it fits, and the queue shows **Auto** next to the box. For that to work:

- Give each SKU a ship size (length, width, and height) on Items.
- Give each box its inside size and a max weight in the **Boxes** sheet. A box with no inside size is measured by its outside size, and one with no max weight takes any weight.

How it picks:

1. Every unit has to fit on its own. Its sides and the box's inside sides are each sorted longest first and compared one by one, so a unit may turn any way that keeps it square to the box.
2. More than one unit also has to fit by volume, using at most 80% of the inside. The rest is left for gaps and padding.
3. A box with a max weight has to carry the parcel: the weight typed or read off the scale, or else the ship weights plus the empty box.
4. Of the boxes that pass, the least outside volume wins, because carriers bill by the outside size. A tie goes to the default box, then by name.

When it cannot pick, the order goes in the default box and the row says why: **No ship size on** the SKUs that lack one, or **Too big for every box**. A too-big order still ships on the default box's size, so check it before you ship. With a single saved box, every order uses it, and the row still warns when the items are too big for it. A box picked in the toolbar, or a rule's box, wins over the automatic pick.

### Pack-bench scale

A USB postal scale plugged into the pack-bench computer can fill in the weight. Rackline reads it straight from the browser (WebHID), so there is nothing to install. That needs Chrome or Edge on a computer, not Safari, Firefox, or a phone, and a scale that shows up as a standard USB scale (HID usage page 0x8D), which most postal scales that need no driver do.

- **Connect scale** asks the browser for permission once. After that, Rackline finds the scale again when the page opens or the scale is plugged back in. **Disconnect** forgets it.
- The live readout shows the weight and the scale's state: **Stable**, **Settling**, **Empty**, or a problem such as below zero or over the scale's limit.
- **Use scale weight** puts the settled weight in the parcel weight, rounded up to the next whole ounce. It is on the order's **Shipping** tab and on Floor → Ship, in both modes. Scan to ship reads the scale by itself.
- In any other browser, or with no scale, the button does not show and you type the weight as before.

### Scan to ship

**Scan to ship** in the Ship queue's header (or `/ship?station=1`) turns the queue into a pack-bench station with one large scan box:

1. **Scan the pack slip.** The slip's barcode is the order number. A barcode gun, or typing the number and pressing Enter, opens the order with its items, the rule that matched, and the box and service Rackline chose, with the reason for each.
2. **Put the box on the scale.** The weight fills in live, and the box, service, and price are worked out again as the weight changes, since a weight rule or a rate can change with it. A typed weight wins over the scale. With no scale connected, the station uses the ship weights plus the box.
3. **Press Enter.** Rackline quick-ships the order at that weight, with the toolbar's box and service if you picked any, and prints the label. A thermal printer bound for shipping labels on this workstation (Settings → Printers) gets the label directly. Otherwise the browser's print dialog opens with only the label on the page. The scan box is then ready for the next slip.

A few details:

- A scan matches the order number with or without `#`, with an `ORD:` or `SO:` prefix, or by just the part after the last dash (`WAVE1` for `ORD-WAVE1`) when only one order in the queue ends that way. A scan that names no order in this building's queue says so and stays on the station. It does not open another page.
- An order that needs attention shows why, with a link to open it, instead of shipping. A held order shows **Ship anyway**.
- **Auto-ship on a settled weight** ships without Enter. Owners turn it on per browser, and it only shows when a scale can connect. Once a slip is scanned, the order ships when the scale moves and then settles on a weight. It fires once per order, and only after the scale has moved since the scan, so a box already sitting on the scale waits for Enter.
- A thermal printer suits a busy bench better than the browser dialog, because it prints without a click.
- In a browser without WebHID, the station says so and you type each weight.
- Manufacturer has no station. Quick-ship is off there, and `/ship` opens Waves.

### What Garage packs away

The menu is short: Bench (Ship, Today, Floor, Shelf map), Parts, Build, Ship, Shelf, Runway, and Settings for owners. Yard, ASNs, waves, replenishment, holds, counts, equipment, labor, 3PL clients, zones, billing, EDI, and Traffic are hidden. Opening one of those pages by link sends you to Today. Floor Pick, Pack, and Ship are not offered as floor tiles or ranked jobs, but they stay reachable from an order for the cases the queue hands off (boxed orders and weighed SKUs).

## 4. Manufacturer: the full warehouse

Manufacturer is built like a traditional WMS. Work is planned, directed, and proven by scan.

### The rules change

The mode sets a workflow policy on the server, not just in the menu:

- **Quick-ship is off.** Opening the Ship queue (`/ship`) takes you to Outbound → Waves instead, and the one-click ship calls answer HTTP 409 `WAREHOUSE_FLOW`: "Manufacturer mode ships through the floor." The batch label page (`/ship/labels`) still opens.
- **Pick is scan-verified.** A pick post must carry a scan of the bay it is picked from and one scan of each SKU on it. You type the qty after the SKU scan, so picking 12 of a SKU takes one scan, not 12. A serial or lot barcode counts as its SKU. Otherwise the server answers 409 `SCAN_REQUIRED`, for example "Scan bay A-01-02 before posting."
- **Pack is scan-verified per unit.** A pack post needs one scan for every unit it packs, counted per SKU. Packing 3 of a SKU takes 3 scans; with 2 the server answers 409 `SCAN_REQUIRED`: "Scan every unit of CORD: 2 of 3 scanned." This applies to plain pack and to **Pack into carton**.
- **Batch pick is scan-verified** on Floor → Wave, with the same bay-and-SKU rule as pick.
- **Office pick and pack hand off to the floor.** On an order page, the main button becomes **Pick on floor** or **Pack on floor** and opens the handheld screen for that order. Office qty fields for pick and pack are hidden. Starting a pick (reserving stock) and shipping a packed order still work from the office.

### Floor screens and scan proof

Floor Pick, Pack, and Wave keep a record of what was scanned since the last post: the bay you are standing at and the SKUs you scanned. That record goes with the post. Quantities start at zero. The post button stays disabled, with the reason shown, until the scans match. After a post, the SKUs clear and the bay stays, because you are still standing there.

Manufacturer also writes each scan to the server as it happens. The screen opens a scan session for the order or wave, and `POST /api/floor/scans` stores the scan (the same client scan id is stored once). Pick, pack, and batch pick name that session. The server checks the scans it recorded — the bay, one SKU scan per pick line, one scan per packed unit, and each serial once — and refuses a second scan of the same serial. A post with no recorded scans is refused. Garage does not open a session and can still post the evidence it always sent.

- **Pick and Wave:** scan the SKU once, then type the qty.
- **Pack:** scan each unit as it goes in the box. Every scan of an item, serial, or lot barcode adds 1 to that line, up to what is left to pack. Scanning the same serial twice counts once, and a scan past what is left is refused ("All 2 SHADE left to pack are already scanned."). If you type a qty ahead of your scans, the next scans count toward it before adding more.

The pick can run guided (one stop at a time) or as a list, with an optional pick map.

### Wave planner

Outbound → Waves opens with **Plan by carrier cutoff**. It takes every open order that is not on a wave and groups it by:

- **Carrier pickup.** This is the carrier's cutoff on the day the Promise board says the order can ship. The carrier comes from the order's service, or the building's default service (Settings → Warehouse).
- **Zone.** An order's zone is the one where most of each SKU sits. An order that spans zones is "Multi-zone".
- **3PL client.**

Groups are sorted earliest pickup first and tagged **Missed pickup**, **Release now** (within 90 minutes), **Today**, or **Later**. Each group has **Create wave**, and **Batch** when it has two or more orders; the wave keeps the zone and client. Orders the Promise board marks short, or waiting on inbound stock, sit in a **waiting on stock** list instead, so a wave never releases work the floor cannot finish.

Owners set cutoffs with **Cutoffs**: one time per carrier, plus an any-carrier time. The default is 3:00pm in the building's timezone. The plan refreshes every minute.

### Today in Manufacturer

Owners and office staff land on **Today**. Operators land on **Floor**. Today adds the cutoff strip: the next pickup, how long is left, its urgency, how many orders still need a wave for today's pickups, and how many are waiting on stock. It links to **Plan waves**.

### What else opens

All of these share the same location and item ledger:

- **Yard** visits and **ASNs**, including vendor cartons and SSCC codes
- Blind **cycle counts**
- **Holds**
- Pick-face **replenishment**
- **Equipment** checkout with pre-use inspection
- **Labor and Performance** scoring
- **Live**, the wall view of the day
- **Traffic**
- **Zones**, and more than one building
- **3PL clients** with client stock and per-client billing
- **EDI** (inbound 856)

Settings → Integrations changes with the mode:

- **Garage** leads its sales channels with Shopify, Etsy, and WooCommerce, then Faire, and shows a **Boxes & default service** card.
- **Manufacturer** leads with Shopify, Faire, and WooCommerce, then Etsy. It swaps the boxes card for **Label printers** and adds **Trading partners & systems**: EDI, 3PL clients, and **Webhooks & API**, which lists the inbound URLs for Shopify orders, carrier tracking, and EDI 856.

## 5. Side by side

| | Garage | Manufacturer |
| --- | --- | --- |
| Feels like | ShipStation | A traditional WMS |
| Home after sign-in | Ship queue, for everyone | Today for owners and office, Floor for operators |
| How an order ships | One click or bulk (up to 50): pick, pack, label, ship, post-back | Wave → scan pick → scan pack → ship |
| Quick-ship | On | Off: `/ship` opens Waves, and the API answers 409 `WAREHOUSE_FLOW` |
| Scan to pick or pack | Optional | Required (409 `SCAN_REQUIRED`): pick scans each SKU once, pack scans every unit |
| Office pick and pack | Yes, on the order page | Hands off to Floor Pick and Pack |
| Waves | Hidden | Planner by cutoff, zone, and client; batch pick |
| Carrier cutoffs | Hidden | Per carrier, on the planner and Today's strip |
| Boxes, ship weights, batch labels | Yes, on the Ship queue | Boxes are per order (`BOX-n`); labels from the order or Floor Ship |
| Channels | Shopify, Etsy, WooCommerce live; Faire and Etsy by CSV | Same channels, wholesale listed first |
| Tracking post-back and retry | Yes | Yes |
| Yard, ASN, counts, holds, replenish | Hidden | Yes |
| Equipment, labor, Live, Traffic | Hidden | Yes |
| 3PL clients, billing, EDI, webhooks | Hidden | Yes |
| Vendor and customer records | Parts → Vendors, Ship → Customers | Inbound → Vendors, Outbound → Customers |
| Pack sizes (inner, case, pallet) | Yes: a case scan counts its eaches | Yes, and one case scan proves every unit in it |
| Bin capacity (max units, weight, volume) | Hidden, but a limit set in Manufacturer still holds | Set per bay; fill % on Locations and the map; putaway skips full bays |
| License plates (tote, pallet, carton) | Hidden; a plate made in Manufacturer stays in step when Garage ships from its bay | `LP-` codes on Stock → Plates and Floor → Plates: build in a bay, move in one scan, receive onto, pick off |
| Customer tracking page (`/t/…`) | **Tracking link** on the Shipped tab, or the order's menu | **Copy tracking link** on the order's menu |
| Return labels (`/r/…`) | Yes, on the return | Yes, on the return |
| International labels with customs | Yes; the queue links to **Add customs** | Yes; the label is refused until the items have customs details |
| Address check before a label | Ship queue, Scan to ship, and the order page: suggested address, edit, or ship to it as it is | The order page: suggested address, edit, or **Accept this address** |
| Menu | Short bench menu | Full office menu plus Settings |

## 6. Switching modes

Owners switch with the toggle in the top bar, or on Settings → Warehouse → Operating mode. The switch applies to the whole organization and takes effect at once.

**What stays the same.** Every SKU, bay, lot, serial, order, box, label, wave, and ledger movement. Nothing is copied or converted, because there is one ledger.

**What changes:**

- The menu and the home screen.
- Which pages open. In Garage, packed-away pages redirect to Today. In Manufacturer, the Ship queue redirects to Waves.
- Whether quick-ship is allowed.
- Whether pick and pack need scans.
- Whether the office can post pick and pack.
- The wave planner and Today's cutoff strip.
- The layout of the Integrations page.

**Orders in flight** keep their status:

- An order half picked in Garage continues on Floor Pick in Manufacturer, where the rest has to be scanned.
- An order half picked in Manufacturer can be finished from the Ship queue after switching to Garage. Quick-ship takes open, picking, picked, packing, and packed orders.
- Waves you made stay on their orders, but the Waves page is hidden in Garage.

## 7. Troubleshooting and FAQ

### What a 409 means

A 409 means Rackline refused the post to protect the ledger. Nothing was half written. The ones you are most likely to see:

- **`WAREHOUSE_FLOW`.** You tried one-click ship in Manufacturer. Pick and pack on the floor, or switch to Garage.
- **`SCAN_REQUIRED`.** A Manufacturer pick or pack was missing a scan. For a pick, scan the bay shown, then each SKU once, then type the qty. For a pack, scan every unit going in the box.
- **`INSUFFICIENT_ATP`.** Not enough free stock. It may be on hand but held, or reserved for another order already being picked.
- **`CLIENT_STOCK`.** The units at that bay belong to another owner. A 3PL client's order only takes that client's stock, and your own orders never take client stock. Pick suggestions, reservations, quick ship, and the Ship queue follow the same rule, so an order whose only stock belongs to someone else shows as short (`INSUFFICIENT_ATP`, naming whose stock ran out) before anyone walks to the bay.
- **`NEED_CARTON_FLOW`.** The order is packed in boxes. Open it and label and ship each box.
- **`NEED_SCAN`.** A catch-weight SKU needs weighing on Floor → Pick before the Ship queue can finish it.
- **`NEED_WEIGHT`.** Live postage needs a weight. Add a ship weight on the SKU, or type one on the order.
- **`NOT_SHIPPABLE`.** The order is cancelled or already shipped.
- **`SHIP_RULE_HOLD`.** A shipping rule holds the order for review, and bulk ship leaves it out. Check it, then press **Ship anyway** on the row or at the station.
- **`SHIP_RULE_SERVICE`.** The rule that matched ships with a service no connected carrier account offers. Edit the rule, or turn the service back on in Settings → Carriers.
- **`ADDRESS_INVALID`.** The ship-to is missing a part, has one that cannot be right, or the carrier could not find it. Use the suggested address, edit it, or ship to it as it is (see Address checks).
- **`CUSTOMS_REQUIRED`.** An item on an international order has no HS code, country of origin, or declared value. The message names the SKU; add them under Customs on the item.
- **`CUSTOMS_UNSUPPORTED`.** A direct USPS account cannot buy international labels in Rackline yet, and a parcel with one tariff code worth over $2,500 needs an export filing (an ITN) that Rackline cannot file. Use EasyPost or ShipEngine, or buy that label on the carrier's site.
- **`NO_RATE`.** No connected carrier account quoted the parcel, so the rate choice had nothing to pick. Choose a service, or check the weight and size.
- **`LIVE_ADDRESS`.** Live postage needs a street and city on the ship-from and ship-to, plus a region and postal code where the country uses them. The ship-to is checked first (`ADDRESS_INVALID`), so this is usually the building's ship-from, or a ship-to accepted as it is.
- **`CARRIER_LIVE`.** The carrier refused the live label. No tracking number was invented.
- **`RETURN_LABEL_UNSUPPORTED`.** A direct UPS, USPS, or DHL account cannot buy return labels in Rackline yet. Choose a service on EasyPost, ShipEngine, FedEx, or Rackline Ground.
- **`OVER_PICK`, `OVER_PACK`, `OVER_RECEIVE`, `OVER_MOVE`.** More than is left on the document.
- **`HELD_STOCK`.** The bay, SKU, or lot is on hold.
- **`JOB_CLAIMED`.** Another operator has that floor job.
- **`NEED_PACKAGE`.** Once a box exists, every packed unit has to go through a box.
- **`MISSING_SKUS`.** A channel CSV has SKUs you do not stock yet.
- **`ALREADY_IMPORTED`.** Every order in the file is already in Rackline.
- **`CHANNEL_AUTH`, `CHANNEL_API`, `CHANNEL_SETUP`.** The channel rejected the keys, returned an error, or needs reconnecting. The message says which.
- **`ETSY_NOT_CONFIGURED`.** `ETSY_API_KEY` is not set on this deployment.
- **`CHANNEL_LIVE`.** Sample orders are for demo connections. Disconnect the live one first.
- **`CHANNEL_NOT_LIVE`.** Sync needs a live connection.
- **`MISSING_APP`.** The Shopify OAuth install needs `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`.
- **`MISSING_LOCATION`.** Pick a Shopify location before pushing live sellable qty.
- **`SHOPIFY_TOKEN`.** Rackline cannot read the Shopify access token, usually because `BETTER_AUTH_SECRET` changed. Paste the token again on Settings → Shopify, or reinstall the app. Fulfillment post-back fails with the same message, and **Retry Shopify** works once the token is back.
- **`CONFLICT`.** Something with that code, SKU, barcode, or name already exists, often because the same save went through twice. The message names the field when it can. Refresh to see the one already saved.
- **`IN_USE`.** The record you tried to delete is still used elsewhere. Remove or move what uses it first.

Two related codes are not 409s. A 400 `BAD_REFERENCE` means the post pointed at something that no longer exists, usually deleted in another tab, so refresh and choose it again. A 500 `INTERNAL` says "Something went wrong on our side" with an 8-character reference. Quote it: the Worker log has the full error under that reference. No error ever shows database text.

When quick-ship has more than one reason to stop, it answers with the first of these: the order itself (`NOT_SHIPPABLE`, `NEED_CARTON_FLOW`, `NEED_SCAN`, `INSUFFICIENT_ATP`), the rule's hold (`SHIP_RULE_HOLD`), the rule's service (`SHIP_RULE_SERVICE`), the address (`ADDRESS_INVALID`), customs (`CUSTOMS_REQUIRED`), the rate (`NO_RATE`), the weight (`NEED_WEIGHT`), then the label itself (`CARRIER_LIVE`, `LIVE_ADDRESS`, `CUSTOMS_UNSUPPORTED`). **Ship anyway** only gets past the hold, so under **Needs attention** the queue names a hold last, after anything else that would still stop the order.

### Questions that come up

**Why is the Connect Etsy shop button missing?** The deployment has no `ETSY_API_KEY`. Set it (and optionally `ETSY_SHARED_SECRET`) as Wrangler secrets, register the callback URL in your Etsy app, and redeploy. Until then, Etsy works by CSV, and **Send a sample order** tries the flow in demo.

**Etsy orders are slow to show up.** Etsy is pulled, not pushed, so new receipts can take up to 15 minutes. **Pull orders now** on Settings → Channels pulls right away.

**WooCommerce says it connected but orders do not arrive.** The key probably could not create the webhook. Copy the URL shown on Settings → Channels into WooCommerce → Settings → Advanced → Webhooks. The 15-minute pull still catches processing orders in the meantime.

**Store or carrier keys stopped working after a redeploy.** WooCommerce and Etsy credentials, the Shopify Admin token and webhook secret, and carrier API keys, secrets, and tracker webhook secrets are sealed with `BETTER_AUTH_SECRET`. If that secret changes, the stored values can no longer be read, and Rackline treats them as missing rather than guessing:

- Reconnect a WooCommerce or Etsy channel.
- On Settings → Shopify, paste the token again, or reinstall the app. A live store never falls back to demo: stock sync, the location list, and fulfillment fail with "Rackline cannot read the Shopify access token" until the token is back.
- On Settings → Carriers, the account shows its keys as missing. Paste them again; until then, a live label is refused with "Live postage needs an API key".

A Shopify token, webhook secret, or carrier key saved by an older version of Rackline, before these were sealed, keeps working and is sealed the first time it is read. A deployed Worker with a secret shorter than 32 characters will not store credentials at all. Only local `http://localhost` uses a built-in development key.

**An order shipped but the store still shows it unfulfilled.** Open the order. If the post-back failed, the menu has **Retry Shopify**, or **Retry WooCommerce tracking** / **Retry Etsy tracking**. If Tracking post-back says **Manual**, the channel has no live connection (Etsy by CSV), so there is nothing to retry: mark it shipped in the channel. Faire orders never post back either.

**Can I test without buying postage?** Yes. Rackline Ground and demo carrier connections mint local tracking numbers. Live postage only happens on a live EasyPost, ShipEngine, UPS, FedEx, USPS, or DHL connection.

**Does the Ship queue reserve stock?** A row being "ready" is a check, not a hold. Stock is reserved when the pick starts, and quick-ship starts the pick.

**Can I use the Ship queue in Manufacturer?** No. `/ship` opens Outbound → Waves instead. If the mode switched while the queue was already open, the queue says so and hides its Ship buttons. Use Waves and the floor, or switch to Garage.

## 8. Vendors and customers

Both modes keep a record for each vendor and each customer. In Garage they are under **Parts → Vendors** and **Ship → Customers**; in Manufacturer, **Inbound → Vendors** and **Outbound → Customers**.

**Vendors** have a contact, email, phone, address, payment terms, a default lead time in days, a currency, and notes. A vendor's page lists its purchases, its vendor returns, and the last price paid for each item bought from it.

- **New purchase** suggests vendors as you type. A name that matches a vendor, ignoring case and extra spaces, links to it. A new name creates the vendor.
- A purchase line typed without a unit cost takes the last price paid to that vendor for the item, then the item's standard cost. The purchase shows a total once every line has a price.
- **Send** fills in the vendor's email, and the purchase shows the vendor's terms and lead time.
- Purchases made from reorder suggestions or the runway link to their vendor the same way.

**Customers** have a name, email, phone, a default ship-to, notes, and the customer ids the sales channels use. A customer's page lists their orders and returns.

Every order links itself to a customer as it arrives, whether from Shopify, WooCommerce, Etsy, a channel CSV, a crowdfunding import, or the office. Rackline tries these in order:

1. The channel's own customer id, when the channel sends one.
2. The email.
3. The same name at the same ship-to address. The same name at a different address is treated as a different person, and so is the same name with a different email.
4. For a typed order or a return with no address to compare, the same name.

If nothing matches, Rackline creates the customer. A match only fills blanks on the record, such as a missing email or ship-to. It never overwrites what is there. On a new office order, picking a known customer fills in their ship-to.

**Existing documents.** Records were made from the names already on your documents: one vendor per distinct vendor name on purchases, ASNs, and vendor returns, and one customer per distinct customer name on orders and returns. Case and extra spaces are ignored. Each customer's ship-to comes from their newest order.

**Renaming.** Each document keeps the name it was made with. Renaming a vendor or customer changes new documents, not old ones. Two vendors cannot share a name, and two customers cannot share an email.

## 9. Pack sizes

An item can have up to three pack sizes: an **inner**, a **case**, and a **pallet**. Each one records how many eaches it holds, and can have its own barcode, weight, and size. Set them on the item's **Pack sizes** tab, in either mode.

- Stock is always kept in eaches. A pack size is a shortcut for counting, not a separate stock unit.
- Each level has to hold whole packs of the level below it. A case of 24 can hold inners of 4 or 6, but not 5.
- A pack barcode has to be its own label. It cannot match an item's barcode or SKU, another pack, or a bay.
- The case becomes the item's alt unit, so a line typed as 2 cases on an ASN or order still means 2 × the case size.

**Scanning a pack counts its eaches.** On Receive, scanning a SKU or a case label counts what arrived. The first scan replaces the quantity Rackline filled in, and each scan after that adds to it. A scan that would take the line past what is still expected is refused, so scan eaches or type the qty for a short case. Pick, Wave, Putaway, and Pack count a case label the same way, and Count adds a case's eaches to what you have counted.

A scan of an each keeps working as before. On Pick, Putaway, and Wave it still fills the whole remaining qty until you start counting with a case label or by typing.

**Manufacturer scan proof.** One scan of a case label proves every unit in it. A pack of 24 bulbs is proven by one scan of their case barcode, where an inner pack of 4 only proves 4 of the 24.

**Case codes that are plain numbers.** An ITF-14 case code such as `10614141000019` starts with digits that also look like a GS1 lot (`10`) or serial (`21`). Rackline tries a plain number as an item or pack barcode first, then as a lot or serial.

## 10. Bin capacity

A bay can have a limit on how many units it holds, how much they weigh, and how much room they take. Owners set the limits on the bay's **Capacity** card under **Stock → Locations**, in units, pounds, and cubic feet. A blank limit means no limit, and a bay with no limits works exactly as before.

- **What counts.** A bay's weight and volume are its stock times each item's weight and size. Rackline takes those from the item's ship weight and dimensions, or else from its smallest pack size. An item with neither counts only toward the unit limit, and the Capacity card names it.
- **What is refused.** A receive or move that would take a bay past any limit is refused with 409 `LOCATION_FULL`, which names the bay, what it would hold, and the limit. That covers receives, putaway, transfers, replenishment, ASN and yard receives, returns, and plate moves.
- **What is not checked.** Counts, adjustments, builds, unpicks, and dekits never hit a limit, so the ledger can always be put right. A bay already over its limit can still give stock up.
- **Owner override.** When an owner hits a full bay, Floor Receive and Put away offer **Fill past its limit**, and the API takes `overrideCapacity: true`. Each override writes a `capacity.override` row to the audit log in the same batch as the stock. An operator who sends the flag gets 403.
- **Putaway.** Suggestions skip full bays, prefer a bay with room for the whole qty, and never suggest more than a bay has room for.

Manufacturer shows a **Fill** column on Locations, the Capacity card on each bay, and fill % on the floor-plan map. The meter turns amber at 85% and red once the bay is full. Garage hides capacity, but a limit set in Manufacturer still holds, and the bay's page still shows it.

## 11. License plates

Manufacturer can group stock in a bay on a **license plate**: a tote, pallet, or carton with its own code, such as `LP-000123`. The list is under **Stock → Plates**, and plates are built on **Floor → Plates**. Garage hides them.

**A plate is a share of its bay.** The bay's balance stays the ledger. A plate's lines say which of those units are on it, and for each item and each lot they never add up to more than the bay holds. Building or breaking a plate changes neither on hand nor available, so ATP, pick plans, quick-ship, and waves work as before. Stock in a bay that is on no plate is **loose**.

On Floor → Plates:

- **Start.** Scan a bay, choose tote, pallet, or carton, and start the plate. Rackline gives it the next code.
- **Build.** With the plate open, scan stock that is in the same bay: a SKU, a case label, or a serial. A SKU scan puts **Qty per scan** units on the plate, 1 unless you change it, and a case label puts on that many cases' eaches. A serial puts on its one unit. **Add all** puts every loose unit of an item on at once. Lots go first-expiring first, skipping expired lots, unless you type one. Building posts no ledger movement, because nothing moved.
- **Move.** Scan another bay. Each line on the plate posts a normal ledger move, so holds, ATP, and bin capacity apply, and an owner can fill a full bay past its limit. Lots and serials go with the plate.
- **Close, reopen, break.** A closed plate takes no more stock, but it can still move and be picked from. Breaking a plate leaves its stock loose in the bay, and the plate open and empty.

**Receiving onto a plate.** On Floor Receive, scan an open plate after the receipt or PO, and the received units go on it. An empty plate moves to the receiving bay with them. A plate with stock on it can only be received into its own bay, so scanning one switches the bay to it.

**Picking.** A pick takes loose stock first and leaves plates alone. To pick off a plate, scan the plate instead of its bay: the plate proves the bay, and the pick comes off it. A closed plate that a pick empties is marked shipped. Waves pick loose stock only.

**When stock leaves a bay another way**, such as a move of loose stock, an adjustment, a count, or a Garage quick-ship, Rackline takes it from loose stock first. Any shortfall comes off open plates before closed ones, newest first. A serial on a plate comes off it when the serial leaves the bay. A plate never claims more than the bay holds.

Plates add three refusals:

- **`PLATE_OVER_LOOSE`.** The build asks for more than is loose in the bay. The message says whether the rest is on plates or in expired lots. Expired stock goes on a plate only when you type its lot.
- **`PLATE_STATUS`.** The plate is closed or shipped, so it cannot do that. Reopen a closed plate to add stock.
- **`PLATE_SHORT`.** The scanned plate does not hold what the pick needs. Pick the rest loose, or from another plate.

Plates show on the bay's page under Locations, with an **On plates** column, on the map's bay panel, and on Floor Lookup, which opens a plate by its code.

## 12. Exception inbox

**Exceptions** gathers problems that used to wait on separate screens into one list: a label the carrier would not sell, a parcel stuck in transit, tracking a store never got, held stock, a count that changed stock. It is in the sidebar in both modes, after Today. Its badge counts open problems and turns amber while one of them is blocking.

**Problems are read live.** Rackline does not copy a problem into the inbox. Each time the list loads, every source reports what is wrong right now, so fixing a problem where it lives, such as releasing the hold, buying the label, or posting a recount, takes it off the list without anyone closing it. The inbox stores only the claim: who has the problem, when its snooze ends, and who resolved it, with their note.

**Claim it like a job.** Anyone can claim an unclaimed problem, and a claimed one belongs to its claimer. An operator who works on someone else's claim gets 409 `EXCEPTION_CLAIMED`. An owner can unclaim it, take it over, or act on it anyway.

- **Snooze** hides a problem for an hour, up to a week. It comes back on its own, or straight away with **Wake**.
- **Resolve** takes a note that says what you did. Use it for a problem handled outside Rackline, such as a refund. A resolved problem stays under **Resolved** until its source clears. If the problem starts again later, it opens again, unclaimed. A bay that went over its limit without an override, because the limit came down or a count found more, has no start time, so it stays resolved until someone reopens it.
- **Inline fixes** call the same endpoint, with the same guards, as the screen the fix belongs to. A fix that screen would refuse is refused here with the screen's own message. A fix that clears the problem takes it off the list.
- Every claim, unclaim, snooze, resolve, reopen, and fix writes an `exception.*` row to the audit log.

What the inbox watches:

| Problem | Severity | Modes | Fix in place |
| --- | --- | --- | --- |
| An order held by a shipping rule | Blocking | Garage | **Ship anyway** |
| A rule whose service no carrier account offers (owners) | Blocking | Garage | |
| A live store whose last order sync failed (owners) | Blocking | Both | **Sync now** |
| A parcel going back to the sender | Blocking | Both | |
| A parcel with a delivery exception, or no tracking news for 5 days | Warning | Both | |
| A label the carrier would not sell or void, or an old label left unvoided | Warning | Both | |
| Etsy or WooCommerce not told that an order shipped | Warning | Both | **Retry post-back** |
| Shopify not told that an order shipped | Warning | Both | **Retry fulfillment** |
| A Shopify stock push that failed (owners) | Warning | Both | **Push stock again** |
| An open hold | Warning | Both | **Release hold** |
| A customer still owed units on a `-BO` backorder | Warning | Both | |
| A supplier ASN the EDI inbox refused (owners) | Warning | Manufacturer | |
| A posted count that changed stock | Info | Manufacturer | |
| A bay over its capacity limit | Info | Manufacturer | |

Garage leaves out counts, EDI, and bay capacity, as it does everywhere else. Operators do not see the owners-only rows.

**Order and limits.** Blocking problems come first, then warnings, then info, oldest first within each. Each source lists at most 50 problems, most severe and then oldest first, and the page says when a source has more. A source that cannot be read is named in a banner, because its problems are missing, not fixed. Failed labels, counts, and refused ASNs look back 30 days, and tracking looks back 45.

**Where it shows.**

- **Garage.** Exceptions is in the Bench menu. Today's **Needs attention** tile counts open problems and opens the inbox. On the Ship queue, the **Needs attention** tab links to the inbox, which also holds what that tab cannot show.
- **Manufacturer.** Today's **Needs attention** tile counts open problems, and the **Exception inbox** card beside the work queue lists the top five. The work-queue lane **Equipment & certifications** is a different list — open checkouts, equipment out of service, and certifications due — and its count is not the inbox. The floor launcher has an **Exceptions** tile for held bays, count variances, and over-full bays. Tapping one claims it and opens the floor screen that fixes it.

**API.** `GET /api/exceptions?warehouseId=…` returns the list, its counts, and which sources it read. `POST /api/exceptions/:source/:key/:verb` with the `warehouseId` claims, unclaims, snoozes (`hours`), resolves (`note`), reopens, or runs a fix (`verb` is `action`, with `actionId`). An owner takes over with `takeOver: true`. A problem that has already cleared answers 409 `EXCEPTION_CLEARED`, and one that someone changed a moment earlier answers 409 `EXCEPTION_CHANGED`.

**Not in the inbox yet.** A short pick is not recorded on its own, so the inbox lists the backorder a short ship leaves. Counts post without an approval step, so a variance is listed as info after it has changed stock. A 409 is answered on the screen that got it; the problem behind it is listed when it lasts, such as a hold or a failed label. A failed carrier connection test stays on Settings → Carriers.

## 13. Customer tracking page

Each order can have a tracking page for its customer, at `/t/…`, in both modes. It needs no sign-in. Every order gets its own long random link, so a link cannot be guessed from an order number or from another link.

- **Copy the link.** **Copy tracking link** is on the order's menu once the order has shipped, has a tracking number, or has a box shipped. In Garage, **Tracking link** on each row of the Ship queue's **Shipped** tab copies the same link. The link is made when the order ships, or the first time someone copies it, and it stays the same after that.
- **What the customer sees.** The shop's name, colour, and logo; the order number; the city, region, and country it is going to; and for each parcel, the carrier and service, the tracking number with the carrier's link, its status, the expected delivery, and its history. The items are listed under their parcels. Status and history come from EasyPost and ShipEngine tracker updates. A parcel whose label is bought but that has not gone yet says **Getting ready**, and one that has gone says **Shipped** until the carrier's first update.
- **What it never shows.** Prices, the customer's name or email, the street, the postcode, Rackline ids, or any other order. A link that matches no order is not found.
- **Branding.** Settings → Warehouse → **Tracking page** sets a **Brand colour**, a hex colour such as `#1f6feb`, and a **Logo URL**, which has to start with `https://`. The return label page uses them too. With neither set, the page shows the shop's name in plain colours.

Rackline emails that link when the customer-email settings say to. See [Customer emails](#17-customer-emails). You can still copy it and paste it into your own message.

## 14. Return labels

A return label is a prepaid label from the customer back to your building. You buy it on the return (RMA), in either mode, and the customer prints it from a link, at `/r/…`, with no sign-in.

1. Open the return and press **Create return label**, on its **Return label** card or its menu. The customer and their address come from the original order. A return with no original order needs the address typed.
2. Pick a service and, if you like, a weight. A blank weight uses the original order's parcel weight, or 16 oz.
3. Press **Buy label**. The label is addressed to the building's **Return address** (Settings → Warehouse), or to its ship-from address when that is blank.

The card then shows the service, tracking number, postage, and when the label was bought, with **Print label** (**Download label** when the carrier sent a file), **Copy customer link**, and **Void**. The customer's page shows the label, the items to send back, and the carrier's updates. The Returns list shows each label's status in the carrier's words, from the same tracker updates as outbound parcels.

- **Carriers.** EasyPost, ShipEngine, FedEx, and Rackline Ground can buy return labels, and so can a demo connection of any carrier. A live direct UPS, USPS, or DHL account cannot yet (`RETURN_LABEL_UNSUPPORTED`).
- **One at a time.** A return has at most one active label, so void it before buying another. A return that is already received takes none.
- **Voiding.** **Void** cancels the label, and a live one goes back to the carrier for a refund. The customer's page then says "This return label was cancelled". Once the carrier has scanned the label, it can no longer be voided.
- **Across a border.** A return label carries no customs details yet, so a carrier may refuse one from another country. Buy that one on the carrier's site for now.

## 15. International shipping

An order is international when its ship-to country is not the building's. Everything here works the same in both modes.

**Addresses.** Rackline reads a ship-to the way its country writes it: US, Canadian, UK, and Australian forms, and postcode-first or city-first lines elsewhere. A state or province and a postal code are only required where the country uses them. The country can be a code (`GB`) or a name (United Kingdom, Hong Kong, Singapore).

**Customs details on items.** Each item has a **Customs** card on its **Settings** tab:

- **HS code**, the item's tariff code.
- **Country of origin**, where it was made.
- **Customs description**. A blank one uses the item's name.
- **Declared value per unit (USD)**.

Every item an international order ships needs an HS code, an origin, and a value. Until it has them, the order waits under **Needs attention** with **Add customs**, which opens the item, and a label is refused with `CUSTOMS_REQUIRED`, naming the SKU. Rates still come back, so the queue can price the order while you fill them in.

**What goes to the carrier.** Rackline sends one declaration per parcel with the label request: each line's description, HS code, origin, qty, weight, and value, marked as merchandise and signed with the shop's name. The line weights never add up to more than the parcel. From the US, the declaration carries the export exemption: `NOEEI 30.36` to Canada, and `NOEEI 30.37(a)` elsewhere. A parcel with one tariff code worth over $2,500 needs a filing (an ITN) that Rackline cannot make, so its label is refused with `CUSTOMS_UNSUPPORTED`.

- **EasyPost and ShipEngine** take the declaration with the shipment, and buy the international counterpart of the service you picked. UPS Ground becomes UPS Standard, 2nd Day Air becomes Worldwide Expedited, and Next Day Air becomes Worldwide Express. FedEx Ground becomes International Economy, and 2Day becomes International Priority. USPS Ground Advantage, Priority Mail, and Priority Mail Express become First-Class Package, Priority Mail, and Priority Mail Express International.
- **UPS, FedEx, and DHL Express accounts** get it in each carrier's own form: UPS's international forms, FedEx's customs clearance with a commercial invoice, and DHL's export declaration.
- **A direct USPS account** cannot buy international labels in Rackline yet (`CUSTOMS_UNSUPPORTED`). Use USPS through EasyPost or ShipEngine.

**Customs forms.** The label page and the batch label page (`/ship/labels`) show a **Customs** card for an international parcel. When the carrier made its own form, a CN22 or a commercial invoice, **Open customs form** opens it to print and attach. Otherwise Rackline's own declaration prints on the page after the label: a CN22 up to $400, and a CN23 above that. A thermal printer gets only the label, so print the form from the browser.

## 16. Address checks

Before Rackline buys a label, it checks the ship-to, in both modes. It looks for three things:

- **Missing parts.** A street and a city, plus a state or province and a postal code where the country uses them.
- **Parts that cannot be right.** A US state, Canadian province, or Australian state that does not exist. A postal code in the wrong form for the US, Canada, the UK, or Australia. A US ZIP code whose first digit belongs to other states ("ZIP code 10001 is not in Oregon."), or a Canadian postal code whose first letter belongs to another province. A street that ends in "Apt", "Unit", "Suite", or "#" with no number after it, and a US or Canadian street with no house number.
- **What the carrier says.** With a live EasyPost or ShipEngine account connected, Rackline also asks it to verify the address, the default account first. The answer is kept for that order and address, so each address is asked about once. An account that errors, or takes more than 4 seconds, is skipped and asked again next time. The Ship queue asks about the same 25 oldest ready orders it prices. The rest use the checks above, or a carrier answer already on file.

When the carrier finds the address, that clears the parts that look wrong, but not a missing part. The carrier's corrected address is offered as a suggestion when it changes something that matters: the country, a postal code or region that was missing, or in the US and Canada, the house number, the state or province, or the postal code (the first five digits of a ZIP). Spelling, capitals, abbreviations, and the city alone do not count, so `Street` against `St` never stops an order. When the carrier cannot find the address at all, the message says so, for example "EasyPost could not verify this address: …".

**Getting past it.** An order with a problem waits under **Needs attention** with the reason (`ADDRESS_INVALID`). A label bought anywhere else is refused with the same code.

- **Use suggested address** saves the carrier's correction on the order.
- **Edit address** opens the ship-to to fix by hand. Saving it runs the check again.
- **Ship anyway to this address**, on the Ship queue, ships to the address as it is, after a warning that a box the carrier cannot deliver comes back, and the carrier may charge for the return. Scan to ship offers **Use suggested address** and **Ship anyway to this address** too.
- The order page shows an **Address check** card in both modes, with **Use suggested address**, **Edit address**, and **Accept this address**. That is how Manufacturer, which ships from the floor, gets past a hold: once accepted, labels from the order page and Floor → Ship go to the address as it is.

An accepted address holds only for that exact address. Edit it, and the check runs again. The address can be edited until the order has a label, ships, or is cancelled. Once one box has a label, the others can still be accepted, but not edited.

The check covers every label Rackline buys for an order: quick-ship, Scan to ship, the order page, boxes, and Floor → Ship. It applies to Rackline Ground and demo labels too, with only the checks Rackline makes itself. Pasting a tracking number skips it, because no label is bought. So does a replacement label for a parcel the carrier flagged on Today, because that parcel's address can no longer change.

## 17. Customer emails

Rackline can email the customer when an order ships, is out for delivery, is delivered, hits a delivery problem, or when a return label is ready. The message uses the shop name, brand colour, and logo from the tracking page. It names the carrier, the service, and the tracking number, links to the customer's page (`/t/…` for a shipment, `/r/…` for a return label), lists the items, and includes an estimated delivery when the carrier has sent one. It never includes a price or a Rackline id.

**Who gets it.** The address is the customer's email on the customer record for the order. A missing address is skipped and the reason is kept on the order. Shipping does not wait on the email and does not fail if mail fails.

**When it sends.** Each event is one of three choices, set in Settings → Warehouse next to the tracking page:

- **Only when the store doesn't notify.** The default. A live Shopify, WooCommerce, or Etsy post-back counts as the store notifying, so Rackline stays quiet. Manual orders, CSV, Faire, and a manual post-back do not, so Rackline sends.
- **Always.**
- **Never.**

The From address stays `MAIL_FROM`. You can set a sender name and a reply-to address. The same page previews a message and can send a test to you. If `MAIL_API_KEY` is not set, the page says so, and the message is logged instead of sent.

**Once each.** One row is kept per order (or return) and event. Shipping the order again, or a repeat tracker update, does not send a second copy. The order page lists what was sent, skipped, or failed, and an owner can resend. On a return, **Email the label to the customer** sends the return-label message, and the policy sends it on its own when it says to.

**When it fails.** A failed customer email shows in Exceptions. **Resend** tries that same row again.

**A few related fixes.**

- **Create return label** and **Accept this address** (including **Ship anyway to this address**) are owner-only. An operator who tries them gets 403.
- The ZIP check compares the ZIP's 3-digit prefix with the ranges that belong to that state. "Seattle, OR 98101" fails, because 981 is Washington and Oregon is 970–979. The first digit alone is not enough, since both start with 9.
- A return label the carrier would not sell or void shows in Exceptions, even though the original order has already shipped.
- An order with no ship weight, on a service that buys live postage, waits under **Needs attention** (`NEED_WEIGHT`).

## 18. Step confirmation

Completing a kit or a work order waits until the recipe steps are confirmed for the quantity you are posting. This is the same in Garage and Manufacturer, on the floor and from the office. A recipe with no steps still completes. Posting zero, or completing a build that is already finished, is unchanged.

Each step has to be confirmed once for every unit in this complete. Posting 3 needs each step confirmed 3 times, or one confirmation that covers those 3. Confirmations already recorded count, so finishing the last unit only asks for what is still short. They are kept on that kit or work order.

- A step tied to a component is confirmed by scanning that component's SKU, barcode, or pack barcode. A pack barcode confirms the pack's eaches.
- A step with no component is confirmed on its own.
- The photo on a step is there so you can see the part. It is not proof, and checking it off on the screen does not count.

Until the steps for this complete are confirmed, the complete button stays disabled and the server answers 409 `STEPS_REQUIRED`, naming the next step, for example "Confirm step 1, Thread the cord, before completing." Each scan or confirm is saved as it happens.

## 19. QC at receive

An item can pull a sample of each receipt for inspection. The percent is on the item page, from 0 to 100. Blank turns it off. 0 and blank receive the line the way they always have. 100 sets every unit of that line aside.

The sample is chosen from the receipt line id and the percent, the same way every time, so it does not depend on chance. Unsampled units are received into the bay and, if you scanned a plate, onto that plate. Sampled units are received onto the bay once and are not available until someone passes them. They are not put on the plate, so a later hold or scrap does not count them a second time.

On Floor → Receive, the sampled units show with three actions. An owner or anyone who can receive can take them:

- **Restock** makes those units available in the bay. They are not received again.
- **Hold** opens an inventory hold for that SKU in the bay, the same kind of hold as Stock → Holds, with reason QC. No return is created.
- **Scrap** posts one adjustment out, so the units leave on hand once.

One photo link can be saved with the decision. The receipt can be finished while QC is still open. Those units stay unavailable until the decision. A hold locks the SKU at that bay the way any hold does, including units of the same SKU that were not in the sample.

## 20. Soft reserve

Creating an order — a store webhook, a CSV paste, a crowdfunding import, or **New order** — reserves ATP for each line. The reserve counts against available qty for quick-ship, the ship queue, and the next order. It does not pin a bay. A 3PL client order only reserves that client's stock.

If the shelf is short, the order still lands. The covered qty is reserved and the rest stays unreserved. That short qty shows in Exceptions as a backorder. Cancel releases the reserve. Starting the pick turns it into the bay allocation pick already used.

The order page shows **Reserved**. Promise still shows the leave-by date, and a **Stock** column says how much is reserved. Asking Promise about a new qty does not reserve anything.

## 21. Same-aisle interleave

After a putaway or a receive, the next ranked job is a pick in that aisle when one is there. That pick beats age, a Shopify order, and a shorter walk. It does not beat a pinned job, a starved pick face, or a lot expiring within 14 days. The reason says the pick is on the aisle the person just worked.

## 22. ABC cycle counts

Manufacturer classifies each SKU from picks and shipments over the last 30 days. The fastest SKUs, the ones that make up the first 80% of that movement, are A and are counted every 7 days. The next through 95% are B, every 30 days. The rest, including SKUs that did not move, are C, every 90 days.

**Plan cycle counts** on Stock → Cycle counts (owners) opens a normal bay count for each due SKU, at its pick face when it has one. Garage does not show the planner. The 15-minute schedule runs the same planner for Manufacturer buildings.

Running it again does not open a second count for a SKU that already has an open count, and it does not recreate a count that was posted inside that SKU's cadence. Posting still uses the existing count screen.

## 23. Offline queue

Floor → Receive and Floor → Pick save a post on the device when the network drops, and the floor shows how many are waiting. This is the same in Garage and Manufacturer. When the connection returns, Rackline sends them in the order they were made. A scan for a pick is sent before that pick.

Each receive and each pick carries an idempotency key. The server stores the key with the outcome. Sending the same key again returns that outcome and does not receive or pick a second time. A different key posts again while the document still has quantity left. When nothing is left, the usual refusal still happens.

A refusal from the server stays on the queue as a failure and is not sent again. Dismiss it to let the posts behind it go out. A dropped connection is retried. A post that is still running under the same key is retried too.

Manufacturer pick and pack still need a server scan session. If opening that session or recording a scan cannot reach the server, it is queued ahead of the pick. Garage still sends its scan list on the pick and does not open a session.

The installed app caches the floor shell, so Receive and Pick still open after a refresh while offline. Calls to `/api` are not cached. The dev server does not register the shell.

## 24. Client rate cards and the client portal

Manufacturer billing starts from the organization rate card on Settings → Billing: 2¢ per piece on hand, 25¢ per picked unit, and $1.50 per shipped carton, unless you change those cents. Each client on Settings → Clients can override any of the three. A blank field keeps the organization rate. Zero is a real price, not a blank. **Draft invoices** uses the card that belongs to the client whose activity is on the invoice.

**Enable portal link** on the client mints a 128-bit token and shows the link once: `/portal/c/…`. **Rotate portal link** replaces it, and the old link stops working. The page needs no sign-in. It shows that client's on-hand totals (SKU, name, qty), open orders (number, status, destination city), recent shipments (order number, carrier, tracking number, status), and that client's own invoices. It does not show other clients, street addresses, or internal ids.

The organization invoice list at `/api/billing/portal/…` is unchanged. That link lists the warehouse's invoices. The client link lists one client.

## 25. Invoice export

Settings → Accounting downloads a QBO/Xero CSV of invoices next to the inventory valuation CSV. Owners only. Each stored invoice line is its own row (invoice number, client code, status, period, line, qty, unit amount, amount). An invoice that has no lines stored is one row for the invoice total. Valuation stays at `/api/accounting/valuation.csv`. Invoices are `/api/accounting/invoices.csv`.

## 26. Public API and outbound webhooks

Settings → Integrations lists API keys and outbound endpoints for owners, in both Garage and Manufacturer. Creating a key shows the secret once. Rackline stores the SHA-256 hash and a short prefix, not the secret. The secret looks like `rk_live_` plus 32 url-safe characters. Send it as `Authorization: Bearer`.

`GET /api/v1/orders`, `GET /api/v1/stock`, and `GET /api/v1/shipments` do not use a browser session. A missing or revoked key is unauthorized. A key without `orders:read`, `stock:read`, or `shipments:read` for that list is forbidden. Each page is at most 50 rows, with a cursor. The JSON uses order numbers and SKUs.

An endpoint is an https URL, or http on localhost. Choose `order.created`, `order.shipped`, and `stock.changed`. Rackline posts the JSON after the order is created, after it ships, and after stock moves. The post runs after the response, so a down receiver does not fail or slow the action. The `Rackline-Signature` header is the hex HMAC-SHA256 of the raw body. The signing secret is sealed at rest and shown once. Each attempt is a delivery row (status, response code, error). A failed delivery shows in Exceptions, and **Send again** posts that same body.
