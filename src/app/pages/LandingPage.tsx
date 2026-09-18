import { Link } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  Factory,
  Map,
  ScanLine,
  Store,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { DotPattern } from "@/components/dot-pattern";

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
];

const stats = [
  { label: "Classic WMS loops", value: "Receive → pick → ship" },
  { label: "Putaway modes", value: "Scan move + transfer docs" },
  { label: "Runs on", value: "Cloudflare Workers + D1" },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
              <Logo size={18} />
            </span>
            Rackline
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#floor" className="hover:text-foreground">
              Floor
            </a>
            <Link to="/login" className="hover:text-foreground">
              Sign in
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <Button asChild>
              <Link to="/signup">
                Open a warehouse
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden pt-16 pb-20 sm:pt-24">
        <DotPattern className="opacity-70" />
        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <Badge variant="outline" className="mb-6">
            Manufacturer to maker WMS
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Warehouse software that starts with{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">one aisle</span>{" "}
            and stays with you.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Receive parts, pick Shopify orders, scan bins on a live map, and complete work orders against a real
            inventory ledger. Built for shops that grow into manufacturers.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link to="/signup">
                Get started
                <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/login">Load the Northwind demo</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/40 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{stat.label}</p>
              <p className="mt-2 text-lg font-semibold">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">The floor, the dock, and the bench</h2>
          <p className="mt-3 text-muted-foreground">
            Classic warehouse loops plus a map, barcodes, and a Shopify channel — without leaving Cloudflare.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="bg-gradient-to-t from-primary/5 to-card shadow-xs">
              <CardHeader>
                <feature.icon className="mb-2 size-5 text-primary" />
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section id="floor" className="bg-muted/30 py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">A floor board that knows the building</h2>
            <p className="mt-4 text-muted-foreground">
              Open receipts, Shopify picks, low-stock SKUs, and the last movements sit next to a rack map. Scan A-01-01
              then A-02-02 and the slot moves — or draft a transfer when you need a document.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li>Northwind demo: Desk Lamp BOM, dock, aisle A/B, shop, outbound</li>
              <li>Cycle counts snapshot a bin and post against current on-hand</li>
              <li>Work orders consume BOM qty and produce finished goods</li>
            </ul>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Try it locally</CardTitle>
              <CardDescription>Seed Northwind and walk the floor in a few minutes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs">
                {`npm install
npx wrangler d1 migrations apply rackline --local
npm run dev`}
              </pre>
              <Button asChild className="w-full">
                <Link to="/login">Sign in or load the demo</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-t py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <span className="flex items-center gap-2 font-medium text-foreground">
            <Logo size={16} /> Rackline WMS
          </span>
          <p>Cloudflare-native warehouse management for makers who grow into manufacturers.</p>
        </div>
      </footer>
    </div>
  );
}
