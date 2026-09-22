import { Link } from "react-router-dom";
import { Github } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/logo";

const footerLinks = [
  { name: "Modes", href: "#modes" },
  { name: "Features", href: "#features" },
  { name: "Pricing", href: "#pricing" },
  { name: "FAQ", href: "#faq" },
  { name: "Get started", to: "/signup" },
];

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t bg-card/50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="space-y-8"
        >
          <div className="grid gap-8 sm:grid-cols-2 sm:gap-10 lg:grid-cols-3">
            <div className="space-y-3">
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-xl font-medium tracking-tight transition-opacity hover:opacity-80"
              >
                <Logo size={18} />
                Rackline
              </Link>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                Cloudflare-native warehouse management. Start in Garage. Switch to Manufacturer when the product takes off — same records.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Quick Links</h3>
              <div className="flex flex-col gap-2">
                {footerLinks.map((item) =>
                  "to" in item && item.to ? (
                    <Link
                      key={item.name}
                      to={item.to}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {item.name}
                    </Link>
                  ) : (
                    <a
                      key={item.name}
                      href={item.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {item.name}
                    </a>
                  ),
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Source</h3>
              <div className="flex gap-2">
                <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                  <a
                    href="https://github.com/brianventr/project-rackline"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="GitHub"
                  >
                    <Github className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col items-center justify-between gap-2 text-center text-sm text-muted-foreground sm:flex-row sm:text-left">
            <span>© {year} Rackline WMS. All rights reserved.</span>
            <span className="font-medium">
              Landing layout from{" "}
              <a
                href="https://github.com/gonzalochale/saas-landing-template"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Gonzalo Chalé
              </a>{" "}
              (MIT)
            </span>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
