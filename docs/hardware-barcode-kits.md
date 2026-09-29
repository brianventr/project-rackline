# Hardware barcode kits

Rackline is browser-first: USB/Bluetooth **HID** barcode guns type into any focused field. No native RF client is required for Garage Mode or Manufacturer.

## Recommended starter kit

| Piece | Spec | Notes |
|---|---|---|
| Handheld scanner | HID keyboard wedge (USB or Bluetooth) | Tested pattern: Code 128 location labels + GS1 AI `(01)/(10)/(21)` |
| Phone / tablet | Chromium with `BarcodeDetector` or ZXing fallback | Floor camera scan when a gun is not nearby |
| Label printer | Zebra-class ZPL or browser/QZ Tray | Setup → Printers + Floor Print |
| Bay / SKU labels | Code 128 from Setup → Labels | Scan bay then SKU for move / receive / count |

## Floor verbs that expect scans

Receive, ASN carton, putaway, pick, pack, ship, count, hold, kit, assemble, lookup, print station.

## QZ Tray (optional)

Bind a workstation printer under Setup → Printers with connection `qz`. Floor Print and shipping labels can dispatch ZPL without a download when QZ is running.

## What we do not ship yet

- Dedicated native iOS/Android RF app (WarehouseOS-class)
- Offline-first PWA sync (planned in spatial/ops phase)
- Vendor-locked scanner SDKs

Pair this doc with the marketing page `/industries/hardware-electronics` and `/use-cases/kit-assembly`.
