import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LandingHero() {
  return (
    <div className="relative overflow-hidden items-center justify-center">
      <section className="mx-auto flex max-w-(--breakpoint-xl) flex-col items-center justify-center gap-12 px-4 py-28 md:px-8">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{
            y: 0,
            opacity: 1,
          }}
          transition={{ duration: 0.6, type: "spring", bounce: 0 }}
          className="mx-auto flex max-w-4xl flex-col items-center justify-center space-y-5 text-center"
        >
          <span className="h-full w-fit rounded-full border border-border bg-card px-2 py-1 text-sm">
            Garage Mode
          </span>
          <h1 className="mx-auto text-pretty bg-linear-to-b from-primary to-foreground bg-clip-text text-4xl font-medium tracking-tighter text-transparent md:text-6xl dark:from-primary">
            Warehouse software that starts with one aisle and stays with you.
          </h1>
          <p className="mx-auto max-w-2xl text-balance text-lg text-muted-foreground">
            Start in Garage: a small shop, a few shelves, and a real ledger. Receive parts, pick
            Shopify orders, and build finished goods. Switch to Manufacturer when the product takes
            off — same parts, orders, and builds.
          </p>
          <div className="flex w-full max-w-sm flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
            <Button asChild className="shadow-lg">
              <Link to="/signup">
                Get started
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/login">Load the Northwind demo</Link>
            </Button>
          </div>
        </motion.div>
      </section>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2, delay: 0.5, type: "spring", bounce: 0 }}
        className="pointer-events-none absolute -top-32 flex h-full w-full items-center justify-end"
      >
        <div className="flex w-3/4 items-center justify-center">
          <div className="h-150 w-12 rounded-3xl bg-primary blur-[70px] will-change-transform max-sm:rotate-15 sm:rotate-35" />
        </div>
      </motion.div>
    </div>
  );
}
