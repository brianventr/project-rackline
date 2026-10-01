# How Rackline works: Garage and Manufacturer

This guide is for the owner. It explains how an order gets from a store to a customer's door, how each part of the app behaves today, and what changes between the two operating modes. For the one-minute version inside the app, open the tour (sliders icon in the top bar → **How Rackline works**, or ⌘K → "How Rackline works"). For single words, type a term with a question mark in the command palette to read the glossary.

Rackline has two modes. The internal value for the second one is `warehouse`; on screen it is called **Manufacturer**.

- **Garage** is a shipping app. Store orders land in one queue, and one click picks, packs, buys the label, ships, and sends tracking back to the store.
- **Manufacturer** is a warehouse system. Orders are waved by carrier cutoff, picked and packed by scan on the floor, then shipped.

Both modes run on the same ledger. Every item, bay, order, and movement is the same record in either mode. The mode changes which screens you see and how an order is allowed to move out.

## 1. Setting up

Most of this is the same in both modes. New organizations start in Garage.

### Deployment (one time)

1. Set `BETTER_AUTH_SECRET` as a Wrangler secret, 32 characters or more. Sign-in needs it, and it is also the key that seals stored credentials: WooCommerce and Etsy keys, the Shopify Admin token, and carrier API keys and secrets (the FedEx client secret lives in the meter number field). A deployed Worker without it refuses to store them.
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

An order that arrives is a promise, not a reservation. Stock is reserved when picking starts.

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
4. **Carrier tracking.** EasyPost and ShipEngine tracker webhooks move orders through at gate, in flight, and arrived on Traffic. Failures show as exceptions on Today, where you can buy a replacement label.

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

### Boxes, weights, and service

- **Box presets.** The **Boxes** sheet (owners) saves your usual boxes: name, length, width and height in inches, and empty weight in ounces. The first box you add becomes the default, and you can switch the default at any time. The toolbar's box picker overrides the default for this run.
- **Parcel weight.** Weight is each SKU's ship weight × qty, plus the box's empty weight. A weight typed on the order wins.
- **Parcel size.** A size typed on the order wins, then the box, then the SKU's own size when the order is a single unit. A row with no ship weight shows **Add weight**, which links to Items.
- **Service.** The toolbar's service picker applies to this run, and owners can press **Save as default** beside it to make that service the building's default. Otherwise each order keeps its own service, then the building's default service (Settings → Warehouse → Default service), then the first enabled service on your default carrier. Rackline Ground is the last fallback. A default whose carrier is disconnected, or whose service is turned off, is ignored.

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
- **`NEED_CARTON_FLOW`.** The order is packed in boxes. Open it and label and ship each box.
- **`NEED_SCAN`.** A catch-weight SKU needs weighing on Floor → Pick before the Ship queue can finish it.
- **`NEED_WEIGHT`.** Live postage needs a weight. Add a ship weight on the SKU, or type one on the order.
- **`NOT_SHIPPABLE`.** The order is cancelled or already shipped.
- **`LIVE_ADDRESS`.** The ship-from or ship-to is missing a street, city, region, or postal code.
- **`CARRIER_LIVE`.** The carrier refused the live label. No tracking number was invented.
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

### Questions that come up

**Why is the Connect Etsy shop button missing?** The deployment has no `ETSY_API_KEY`. Set it (and optionally `ETSY_SHARED_SECRET`) as Wrangler secrets, register the callback URL in your Etsy app, and redeploy. Until then, Etsy works by CSV, and **Send a sample order** tries the flow in demo.

**Etsy orders are slow to show up.** Etsy is pulled, not pushed, so new receipts can take up to 15 minutes. **Pull orders now** on Settings → Channels pulls right away.

**WooCommerce says it connected but orders do not arrive.** The key probably could not create the webhook. Copy the URL shown on Settings → Channels into WooCommerce → Settings → Advanced → Webhooks. The 15-minute pull still catches processing orders in the meantime.

**Store or carrier keys stopped working after a redeploy.** WooCommerce and Etsy credentials, the Shopify Admin token, and carrier API keys and secrets are sealed with `BETTER_AUTH_SECRET`. If that secret changes, the stored values can no longer be read, and Rackline treats them as missing rather than guessing:

- Reconnect a WooCommerce or Etsy channel.
- On Settings → Shopify, paste the token again, or reinstall the app. A live store never falls back to demo: stock sync, the location list, and fulfillment fail with "Rackline cannot read the Shopify access token" until the token is back.
- On Settings → Carriers, the account shows its keys as missing. Paste them again; until then, a live label is refused with "Live postage needs an API key".

A Shopify token or carrier key saved by an older version of Rackline, before these were sealed, keeps working and is sealed the first time it is read. A deployed Worker with a secret shorter than 32 characters will not store credentials at all. Only local `http://localhost` uses a built-in development key.

**An order shipped but the store still shows it unfulfilled.** Open the order. If the post-back failed, the menu has **Retry Shopify**, or **Retry WooCommerce tracking** / **Retry Etsy tracking**. If Tracking post-back says **Manual**, the channel has no live connection (Etsy by CSV), so there is nothing to retry: mark it shipped in the channel. Faire orders never post back either.

**Can I test without buying postage?** Yes. Rackline Ground and demo carrier connections mint local tracking numbers. Live postage only happens on a live EasyPost, ShipEngine, UPS, FedEx, USPS, or DHL connection.

**Does the Ship queue reserve stock?** A row being "ready" is a check, not a hold. Stock is reserved when the pick starts, and quick-ship starts the pick.

**Can I use the Ship queue in Manufacturer?** No. `/ship` opens Outbound → Waves instead. If the mode switched while the queue was already open, the queue says so and hides its Ship buttons. Use Waves and the floor, or switch to Garage.
