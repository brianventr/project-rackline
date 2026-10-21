/**
 * What the homepage says a plan costs. Signup does not charge a card.
 *
 * Garage stays free through a small monthly cap so a bench can start. Shop and Manufacturer
 * are priced as a floor WMS: above inventory apps (Craftybase, SOS, Zoho) and under the
 * mid-market names a growing shop actually compares — Unleashed Core is about $399 and Pro
 * about $729, Katana Core plus its WMS add-on is about $448, Cin7 starts near $349, Packiyo
 * is about $949, and ShipHero brands have been about $1,995. Shop sits with that entry
 * cluster. Manufacturer sits with Unleashed Pro, under Packiyo and well under ShipHero.
 */

export type PlanId = "garage" | "shop" | "manufacturer";

export type Plan = {
  id: PlanId;
  name: string;
  desc: string;
  /** Whole dollars per month. Zero is free. */
  price: number;
  /** Shown under the price. Null when the plan is not capped. */
  cap: string | null;
  mostPopular: boolean;
  cta: string;
  href: "/signup" | "/login";
  features: string[];
};

/** Garage stays free through this many shipped orders in a month. */
export const GARAGE_FREE_ORDERS = 50;

export const PLANS: readonly Plan[] = [
  {
    id: "garage",
    name: "Garage",
    desc: "One bench, one building, and the ship queue",
    price: 0,
    cap: `Free up to ${GARAGE_FREE_ORDERS} orders a month`,
    mostPopular: false,
    cta: "Start free",
    href: "/signup",
    features: [
      "Ship queue — pick, pack, label, and post tracking",
      "Shopify, Etsy, or WooCommerce",
      "Recipes, builds, and kits",
      "One inventory ledger",
      "Shelf map",
    ],
  },
  {
    id: "shop",
    name: "Shop",
    desc: "The floor, once the bench is the business",
    price: 349,
    cap: "One building",
    mostPopular: true,
    cta: "Open a shop",
    href: "/signup",
    features: [
      "Everything in Garage",
      "Unlimited orders",
      "Directed putaway, pick, and pack",
      "Lots, serials, and FEFO",
      "Promise — when the order leaves",
      "Runway and restock",
    ],
  },
  {
    id: "manufacturer",
    name: "Manufacturer",
    desc: "Waves, a second building, or stock for someone else",
    price: 799,
    cap: null,
    mostPopular: false,
    cta: "Open the warehouse",
    href: "/signup",
    features: [
      "Everything in Shop",
      "Waves, yard, and ASN",
      "More than one building",
      "3PL clients and billing",
      "Counts, holds, and replenishment",
    ],
  },
];

export const PLAN_NOTE =
  "Signup opens Garage and does not charge a card. Shop and Manufacturer are the prices when billing is on.";
