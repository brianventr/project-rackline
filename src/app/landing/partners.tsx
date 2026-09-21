import { Cloud, Database, Package, ScanBarcode, Store, Truck } from "lucide-react";
import { motion } from "motion/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const integrations = [
  { name: "Shopify", icon: Store, color: "#95BF47" },
  { name: "Cloudflare Workers", icon: Cloud, color: "#F38020" },
  { name: "D1", icon: Database, color: "#2563EB" },
  { name: "EasyPost", icon: Package, color: "#E16522" },
  { name: "ShipEngine", icon: Truck, color: "#5C43F5" },
  { name: "HID scanners", icon: ScanBarcode, color: "#c2410c" },
];

export function LandingPartners() {
  return (
    <section className="mx-auto flex w-full max-w-(--breakpoint-md) flex-col items-center justify-center gap-10 px-4 py-24 text-center md:px-8">
      <motion.div
        initial={{ y: 20, opacity: 0, filter: "blur(3px)" }}
        whileInView={{
          y: 0,
          opacity: 1,
          filter: "blur(0px)",
        }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, type: "spring", bounce: 0 }}
        className="flex flex-col gap-3"
      >
        <h2 className="bg-linear-to-b from-foreground to-muted-foreground bg-clip-text text-xl font-semibold text-transparent sm:text-2xl">
          Built to sit next to the tools you already run
        </h2>
      </motion.div>
      <div className="grid w-full grid-cols-3 grid-rows-2 place-items-center gap-5 sm:grid-cols-6 sm:grid-rows-1">
        <TooltipProvider>
          {integrations.map((item, index) => (
            <Tooltip key={item.name}>
              <TooltipTrigger asChild>
                <div className="shrink-0">
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    whileInView={{
                      y: 0,
                      opacity: 1,
                    }}
                    viewport={{ once: true }}
                    transition={{
                      duration: 1,
                      delay: index * 0.1,
                      type: "spring",
                      bounce: 0,
                    }}
                    className="flex size-12 items-center justify-center rounded-xl border border-border bg-card"
                    aria-label={item.name}
                  >
                    <item.icon className="size-8" strokeWidth={2.25} style={{ color: item.color }} />
                  </motion.div>
                </div>
              </TooltipTrigger>
              <TooltipContent>{item.name}</TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>
    </section>
  );
}
