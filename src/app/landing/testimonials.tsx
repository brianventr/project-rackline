import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

const testimonials = [
  {
    name: "Maya Chen",
    role: "Picker · Northwind demo",
    content:
      "The next-job queue already knows the walk. Remaining SKUs become numbered stops on the map — I tap a bay and keep scanning.",
    rating: 5,
  },
  {
    name: "Jordan Dock",
    role: "Dock operator · Northwind demo",
    content:
      "ASN cartons land one box at a time. Over-receive is a 409, not a surprise on the ledger after the truck leaves.",
    rating: 5,
  },
  {
    name: "Shop floor lead",
    role: "Shopify channel",
    content:
      "Checkouts become pick tickets the same afternoon. After we ship, fulfillment posts back — or stays in demo until the shop is live.",
    rating: 5,
  },
  {
    name: "Maker-owner",
    role: "Bench and warehouse",
    content:
      "The Desk Lamp BOM lives in the same building as the parts. Work orders consume components and produce finished goods without a second system.",
    rating: 5,
  },
  {
    name: "Warehouse map user",
    role: "Scan-to-move",
    content:
      "Scan A-01-01, then A-02-02, and the slot moves. Locations have aisle, rack, bay, and XYZ — stock is never just a number on the item.",
    rating: 5,
  },
  {
    name: "Pack station",
    role: "Cartons and labels",
    content:
      "BOX-1 and BOX-2 get weight, dims, and a label each. We ship when every packed unit is in a carton that has tracking.",
    rating: 5,
  },
  {
    name: "Cycle counter",
    role: "Blind counts",
    content:
      "The floor hides system qty until the count posts. Typing 0 is a real empty bay. Unexpected SKUs can still be added and adjusted.",
    rating: 5,
  },
  {
    name: "Manufacturer on one aisle",
    role: "Growing the building",
    content:
      "We started with one rack. Holds, FEFO, kits, and a second warehouse all sit on the same location:item ledger.",
    rating: 5,
  },
];

function StarIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-yellow-500 sm:h-4 sm:w-4"
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  );
}

export function LandingTestimonials() {
  const [showAll, setShowAll] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const visibleCount = isMobile ? 2 : 6;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateIsMobile = () => setIsMobile(mediaQuery.matches);

    updateIsMobile();
    mediaQuery.addEventListener("change", updateIsMobile);

    return () => {
      mediaQuery.removeEventListener("change", updateIsMobile);
    };
  }, []);

  return (
    <section id="testimonials" className="scroll-mt-20 px-3 py-16 sm:px-4 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mb-12 flex flex-col gap-3 text-center sm:mb-20"
        >
          <h2 className="bg-linear-to-b from-foreground to-muted-foreground bg-clip-text text-xl font-semibold text-transparent sm:text-2xl">
            Voices from the floor
          </h2>
          <p className="mx-auto max-w-xl text-center text-muted-foreground">
            What the Northwind demo and a growing shop actually exercise — dock, aisle, bench, and
            Shopify — not a crowd of unnamed companies.
          </p>
        </motion.div>

        <div className="relative">
          <div className="columns-2 gap-3 space-y-3 sm:gap-8 sm:space-y-8 md:columns-2 lg:columns-3">
            {(showAll ? testimonials : testimonials.slice(0, visibleCount)).map(
              (testimonial, index) => (
                <motion.div
                  key={testimonial.name}
                  initial={{ y: 20, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.6,
                    delay: index * 0.05,
                    ease: "easeOut",
                  }}
                  className="mb-3 break-inside-avoid sm:mb-8"
                >
                  <div className="rounded-lg border border-border bg-card p-3 transition-colors duration-300 sm:rounded-xl sm:p-6">
                    <div className="mb-2 flex sm:mb-4">
                      {Array.from({ length: testimonial.rating }).map((_, i) => (
                        <StarIcon key={i} />
                      ))}
                    </div>

                    <p className="mb-4 text-xs leading-snug text-muted-foreground sm:mb-6 sm:text-sm sm:leading-relaxed">
                      “{testimonial.content}”
                    </p>

                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-linear-to-br from-primary/20 to-primary/10 text-xs font-medium sm:h-10 sm:w-10 sm:text-sm">
                        {testimonial.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate text-xs font-semibold sm:text-sm">
                          {testimonial.name}
                        </h4>
                        <p className="truncate text-[10px] leading-tight text-muted-foreground sm:text-xs">
                          {testimonial.role}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ),
            )}
          </div>

          {!showAll && testimonials.length > visibleCount && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-background via-background/90 to-transparent" />
          )}
        </div>

        {!showAll && testimonials.length > visibleCount && (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" onClick={() => setShowAll(true)}>
              Show more
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
