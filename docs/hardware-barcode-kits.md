# Hardware barcode kits

Rackline is browser-first: USB/Bluetooth **HID** barcode scanners send label text followed by Enter to the floor scan field. No native RF client is required for Garage Mode or Manufacturer. Ordinary quantity, notes, and dialog fields stay under the operator's control.

## Recommended starter kit

| Piece | Spec | Notes |
|---|---|---|
| Handheld scanner | 2D imager with Bluetooth HID keyboard mode and Enter suffix | Code 128 location labels and GS1 AI `(01)/(10)/(21)` are supported by the label parser; a 2D imager also reads QR codes |
| iPad | Safari, rugged case, hand strap, and a stand for a packing bench | Portrait and landscape floor layouts; Add to Home Screen opens the existing standalone floor app |
| Phone / tablet camera | `BarcodeDetector` where available, ZXing fallback otherwise | Camera access requires permission and a secure origin |
| Label printer | Zebra-class ZPL or browser/QZ Tray | Setup → Printers + Floor Print |
| Bay / SKU labels | Code 128 from Setup → Labels | Scan bay then SKU for move / receive / count |

## iPad pilot

Start with a rugged hand-strap case and a Bluetooth 2D scanner. Socket Mobile's 2D Bluetooth scanners and Zebra's Bluetooth handhelds are useful product families to shortlist; confirm iPad HID keyboard support for the exact model before buying. An integrated scanner case is another option once the iPad model is fixed. It must expose keyboard input to Safari: an accessory that only offers a vendor native SDK needs a separate integration.

1. Pair the scanner through iPad Bluetooth settings. Configure **HID keyboard mode**, an **Enter / CR suffix**, and no custom prefix. Use the same keyboard layout on scanner and iPad.
2. Open Floor in Rackline. Select **Scanner accessory** in Scan station. This preference is saved on the device. The scan field requests no on-screen keyboard; slow Bluetooth input is accepted when the field is focused.
3. Tap **Scan** in the bottom navigation or the scan field after editing another control, then scan a bay, SKU, or order. A completed scan is routed once. Subsequent scans replace the previous value.
4. Use **Type instead** to open manual entry. **Return to scanner** returns to accessory capture. Camera remains available separately.
5. The displayed mode confirms how Rackline accepts input. It does not assert that an accessory is paired or connected; **last scan** confirms that data reached the app.

Configure the scanner's own decode beep if audible hardware confirmation is useful. iPad browser vibration is not generally available; Rackline also provides visual scan feedback. Test the exact accessory with actual warehouse labels, repeat scans, quantity edits, reconnect after sleep, and a full shift before choosing a fleet. The software has automated keyboard-scan and responsive browser checks; physical iPad/accessory validation is still required.

## Floor verbs that expect scans

Receive, ASN carton, putaway, pick, pack, ship, count, hold, kit, assemble, lookup, print station.

## QZ Tray (optional)

Bind a workstation printer under Setup → Printers with connection `qz`. Floor Print and shipping labels can dispatch ZPL without a download when QZ is running.

## What we do not ship yet

- Dedicated native iOS/Android RF app (WarehouseOS-class)
- Offline-first PWA sync (planned in spatial/ops phase)
- Vendor-locked scanner SDKs

Pair this doc with the marketing page `/industries/hardware-electronics` and `/use-cases/kit-assembly`.
