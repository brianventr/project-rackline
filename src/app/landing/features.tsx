import {
  Boxes,
  ClipboardList,
  Factory,
  Gauge,
  Map,
  Radar,
  ScanLine,
  Store,
  Warehouse,
} from "lucide-react";
import { motion } from "motion/react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    title: "One inventory ledger",
    body: "Receive, move, pick, ship, adjust, and assemble against the same on-hand engine. Short stock returns a 409, not a silent lie.",
    icon: Boxes,
  },
  {
    title: "Floor map and scan-to-move",
    body: "Bins sit on a 2D floor plan and a 3D rack view. Scan a location barcode, then the next one — the whole slot transfers.",
    icon: Map,
  },
  {
    title: "Next job from the same ledger",
    body: "Every warehouse and bench verb shares one ranked queue. Pin, starved replenish, FEFO, and walk distance — assignment is optional, so a solo shop still just scans.",
    icon: ClipboardList,
  },
  {
    title: "Shopify to pick ticket",
    body: "Checkouts land as Rackline orders. After the floor ships, fulfillment posts back to Shopify — or stays in demo mode.",
    icon: Store,
  },
  {
    title: "Maker to manufacturer",
    body: "BOMs and work orders consume components and produce finished goods in the same warehouse that stores the parts.",
    icon: Factory,
  },
  {
    title: "Gun scanners, no extra app",
    body: "USB and Bluetooth HID scanners work on every screen. Chromium cameras can read Code 128 location labels.",
    icon: ScanLine,
  },
  {
    title: "Locations that are physical",
    body: "Aisle, rack, bay, level, and XYZ on the map. Print labels. Stock never lives on the item record alone.",
    icon: Warehouse,
  },
  {
    title: "Shipment traffic control",
    body: "A live country/state radar of packed and in-flight orders, filtered by SKU — lane estimates from the warehouse, not fake GPS.",
    icon: Radar,
  },
  {
    title: "Staff and SKU pace",
    body: "Score the floor against expected time from lot, serial, catch-weight, expiry, and walk — not raw units per hour. See who handles which SKU, and which SKUs are hard for everyone.",
    icon: Gauge,
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 py-20 md:px-8">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mx-auto mb-12 max-w-2xl text-center sm:mb-16"
      >
        <h2 className="bg-linear-to-b from-foreground to-muted-foreground bg-clip-text text-xl font-semibold text-transparent sm:text-2xl">
          The floor, the dock, and the bench
        </h2>
        <p className="mt-3 text-muted-foreground">
          Classic warehouse loops plus a map, barcodes, and a Shopify channel — without leaving
          Cloudflare.
        </p>
      </motion.div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, index) => (
          <motion.div
            key={feature.title}
            initial={{ y: 20, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.05, ease: "easeOut" }}
          >
            <Card className="h-full bg-gradient-to-t from-primary/5 to-card shadow-xs">
              <CardHeader>
                <feature.icon className="mb-2 size-5 text-primary" />
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.body}</CardDescription>
              </CardHeader>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
