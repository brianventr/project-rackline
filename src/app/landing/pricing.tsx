import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const plans = [
  {
    name: "Northwind demo",
    desc: "A stocked shop you can walk in minutes",
    price: 0,
    isMostPop: false,
    href: "/login" as const,
    cta: "Load the demo",
    features: [
      "Seeded Northwind Makers warehouse",
      "Desk Lamp BOM, dock, aisle A/B, shop, outbound",
      "Sample picker and dock operator",
    ],
  },
  {
    name: "Shop",
    desc: "One building, Shopify, and the floor",
    price: 0,
    isMostPop: true,
    href: "/signup" as const,
    cta: "Open a warehouse",
    features: [
      "Garage Mode — the founder bench",
      "One inventory ledger",
      "Shopify checkouts to pick tickets",
      "Floor map and scan-to-move",
      "Gun scanners on every screen",
      "Receive, pick, pack, and ship",
    ],
  },
  {
    name: "Manufacturer",
    desc: "The same ledger when the bench shows up",
    price: 0,
    isMostPop: false,
    href: "/signup" as const,
    cta: "Open a warehouse",
    features: [
      "Everything in Shop",
      "BOMs, kits, and work orders",
      "Multi-warehouse and 3PL clients",
      "Waves, ASN cartons, and yard",
      "Holds, FEFO, and as-built genealogy",
    ],
  },
];

export function LandingPricing() {
  return (
    <section id="pricing" className="scroll-mt-20 mx-auto w-full max-w-7xl px-3 py-16 sm:px-4 sm:py-24 md:px-6">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-12 flex flex-col gap-3 text-center sm:mb-16"
      >
        <h2 className="bg-linear-to-b from-foreground to-muted-foreground bg-clip-text text-xl font-semibold text-transparent sm:text-2xl">
          Start on the floor. Stay when you grow.
        </h2>
        <p className="mx-auto max-w-xl text-center text-muted-foreground">
          Self-serve today. Load the Northwind demo, or open your own warehouse — both sit on the
          same Cloudflare-native ledger.
        </p>
      </motion.div>

      <div className="mx-auto grid max-w-5xl gap-4 sm:gap-6 md:grid-cols-3 md:gap-8">
        {plans.map((plan, index) => (
          <motion.div
            key={plan.name}
            initial={{ y: 20, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: index * 0.1 }}
            className={`relative ${plan.isMostPop ? "md:scale-[1.03]" : ""}`}
          >
            <Card
              className={`relative h-full gap-0 py-0 rounded-2xl ${
                plan.isMostPop
                  ? "border-2 border-primary bg-primary/5 shadow-lg"
                  : "border border-border"
              }`}
            >
              {plan.isMostPop && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 transform">
                  <span className="rounded-full border-2 border-primary bg-card px-3 py-1 text-xs font-medium sm:px-4 sm:text-sm">
                    Most Popular
                  </span>
                </div>
              )}

              <CardContent className="p-4 pt-6 sm:p-6 sm:pt-8">
                <div className="mb-5 text-center sm:mb-6">
                  <h3 className="mb-2 text-lg font-semibold sm:text-xl">{plan.name}</h3>
                  <p className="mb-3 text-sm text-muted-foreground sm:mb-4">{plan.desc}</p>
                  <div className="flex items-baseline justify-center">
                    <span className="text-3xl font-bold sm:text-4xl">${plan.price}</span>
                    <span className="ml-1 text-sm text-muted-foreground sm:text-base">/month</span>
                  </div>
                </div>

                <Separator className="my-4 sm:my-6" />

                <ul className="space-y-2.5 sm:space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center text-xs sm:text-sm">
                      <Check className="mr-2 h-4 w-4 shrink-0 text-primary sm:mr-3" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="p-4 pt-0 sm:p-6 sm:pt-0">
                <Button
                  asChild
                  className="w-full"
                  variant={plan.isMostPop ? "default" : "outline"}
                  size="lg"
                >
                  <Link to={plan.href}>{plan.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
