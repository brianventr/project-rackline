/**
 * What the homepage says a plan costs. Signup does not charge a card; these are the prices
 * the product is packaged at, between a free Shopify app and a $179 phone WMS.
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
    price: 79,
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
    price: 179,
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
