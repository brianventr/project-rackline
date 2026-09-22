import { Check } from "lucide-react";
import { motion } from "motion/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const garage = [
  "Today, floor, and shelf map",
  "Buy parts and receive",
  "Recipes, builds, and kits",
  "Orders and returns",
  "On hand, items, and runway",
  "Shopify, carriers, team, and printers",
];

const manufacturer = [
  "Everything in Garage",
  "Yard, ASN, and waves",
  "Equipment and labor",
  "Counts, holds, and replenishment",
  "Traffic",
  "3PL clients, zones, EDI, and billing",
  "More than one building",
];

export function LandingModes() {
  return (
    <section id="modes" className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 py-20 md:px-8">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mx-auto mb-12 max-w-2xl text-center sm:mb-16"
      >
        <h2 className="bg-linear-to-b from-foreground to-muted-foreground bg-clip-text text-xl font-semibold text-transparent sm:text-2xl">
          Garage, then Manufacturer
        </h2>
        <p className="mt-3 text-muted-foreground">
          Same colors. Same parts, orders, and builds. The top-bar switch changes the scale of the shop.
        </p>
      </motion.div>
      <div className="grid gap-4 md:grid-cols-2">
        <ModeCard
          title="Garage"
          description="Small scale while the product is still early."
          items={garage}
          delay={0}
        />
        <ModeCard
          title="Manufacturer"
          description="Full scale once the product takes off."
          items={manufacturer}
          delay={0.08}
        />
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
        One ledger. Records made in Garage are already there when you switch to Manufacturer.
      </p>
    </section>
  );
}

function ModeCard({
  title,
  description,
  items,
  delay,
}: {
  title: string;
  description: string;
  items: string[];
  delay: number;
}) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      whileInView={{ y: 0, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    >
      <Card className="h-full bg-gradient-to-t from-primary/5 to-card shadow-xs">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item} className="flex items-start text-sm">
                <Check className="mt-0.5 mr-2 size-4 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </motion.div>
  );
}
