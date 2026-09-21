import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const accordionItems = [
  {
    title: "Does Shopify talk to Rackline?",
    content: (
      <div className="text-muted-foreground">
        Yes. Checkouts land as pick tickets. After the floor ships, Rackline posts fulfillment back
        — including carton tracking — or stays in demo mode until you connect a live shop.
      </div>
    ),
  },
  {
    title: "How do I try it without an empty warehouse?",
    content: (
      <div className="text-muted-foreground">
        Load the Northwind Makers demo from{" "}
        <Link to="/login" className="text-primary underline">
          sign in
        </Link>
        . You get a dock, aisle A/B, shop, outbound, a Desk Lamp BOM, and sample floor users.
      </div>
    ),
  },
  {
    title: "Do I need a special scanner app?",
    content: (
      <div className="text-muted-foreground">
        No. USB and Bluetooth HID guns type into every screen. Chromium cameras can read Code 128
        location labels, with ZXing as a fallback. There is no extra mobile app to install.
      </div>
    ),
  },
  {
    title: "What happens when stock is short?",
    content: (
      <div className="text-muted-foreground">
        The ledger refuses the move. Pick start that would oversell, over-receive, over-pack, and
        similar posts return HTTP 409 instead of quietly going negative.
      </div>
    ),
  },
  {
    title: "What does it run on?",
    content: (
      <div className="text-muted-foreground">
        Cloudflare Workers and D1. The public site is this landing page; after sign-in the floor
        board, rack map, and WMS loops run as a single-page app on Workers static assets.
      </div>
    ),
  },
  {
    title: "What is Garage Mode?",
    content: (
      <div className="text-muted-foreground">
        New organizations start in Garage Mode — the bench founders and inventors use before a
        warehouse. Receive, make, pick, and ship. Setup → Warehouse opens the full floor (yard,
        waves, ASN, equipment, 3PL) on the same location:item ledger.
      </div>
    ),
  },
];

export function LandingFaq() {
  return (
    <motion.section
      id="faq"
      initial={{ y: 20, opacity: 0 }}
      whileInView={{
        y: 0,
        opacity: 1,
      }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.5, type: "spring", bounce: 0 }}
      className="relative mx-auto flex w-full max-w-(--breakpoint-xl) scroll-mt-20 flex-col items-center justify-center gap-5 px-4 py-28 md:px-8"
    >
      <div className="flex flex-col items-center justify-center gap-3">
        <h4 className="bg-linear-to-b from-foreground to-muted-foreground bg-clip-text text-2xl font-bold text-transparent sm:text-3xl">
          FAQ
        </h4>
        <p className="max-w-xl text-center text-muted-foreground">
          Shopify, scanners, the Northwind demo, and the ledger.
        </p>
      </div>
      <div className="flex w-full max-w-lg">
        <Accordion type="multiple" className="w-full">
          {accordionItems.map((item, index) => (
            <AccordionItem
              key={item.title}
              value={`item-${index}`}
              className="text-muted-foreground"
            >
              <AccordionTrigger className="text-left">{item.title}</AccordionTrigger>
              <AccordionContent>{item.content}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </motion.section>
  );
}
