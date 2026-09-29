import { Link } from "react-router-dom";
import { motion } from "motion/react";

const ecosystems = [
  { label: "Makers", path: "/industries/makers" },
  { label: "Garage Mode", path: "/use-cases/garage-warehouse" },
  { label: "Shopify WMS", path: "/use-cases/shopify-wms" },
  { label: "Kickstarter", path: "/use-cases/kickstarter-fulfillment" },
  { label: "Kit assembly", path: "/use-cases/kit-assembly" },
  { label: "Stocky replacement", path: "/use-cases/stocky-replacement" },
  { label: "Beauty FEFO", path: "/industries/beauty" },
  { label: "Food & coffee", path: "/industries/food-beverage" },
  { label: "Hardware", path: "/industries/hardware-electronics" },
  { label: "Board games", path: "/industries/board-games" },
];

/** Maker ecosystem strip under the hero — links into industry / use-case LPs. */
export function LandingEcosystems() {
  return (
    <section className="border-y bg-muted/20">
      <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Built for maker ecosystems
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
            Crowdfunding waves, Shopify DTC, kits, FEFO brands, and the garage that becomes a warehouse.
          </p>
        </motion.div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          {ecosystems.map((item, index) => (
            <motion.div
              key={item.path}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: index * 0.03 }}
            >
              <Link
                to={item.path}
                className="text-sm font-medium tracking-tight text-foreground underline-offset-4 hover:underline"
              >
                {item.label}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
