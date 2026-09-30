import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Boxes, ChevronDown, ClipboardList, Map, Menu, Store, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { marketingNavGroups } from "@/domain/marketing-pages";

const productItems = [
  {
    name: "One inventory ledger",
    href: "/#features",
    description: "Receive, move, pick, and ship against the same on-hand engine.",
    icon: Boxes,
  },
  {
    name: "Floor map and scan",
    href: "/#features",
    description: "Bins sit on a 2D plan and a 3D rack view. Scan one bay, then the next.",
    icon: Map,
  },
  {
    name: "Shopify to pick ticket",
    href: "/use-cases/shopify-wms",
    description: "Checkouts land as Rackline orders. After ship, fulfillment posts back.",
    icon: Store,
  },
  {
    name: "Next job from the ledger",
    href: "/#features",
    description: "Every warehouse and bench verb shares one ranked queue.",
    icon: ClipboardList,
  },
];

const menuItems = [
  { name: "Features", href: "/#features" },
  { name: "Pricing", href: "/#pricing" },
  { name: "FAQ", href: "/#faq" },
];

const navGroups = marketingNavGroups();

export function LandingNavbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const showNavbarBlur = isScrolled || isMenuOpen;

  return (
    <nav
      className={`sticky top-0 z-50 w-full transition-[background-color,backdrop-filter] duration-300 ease-out ${
        isMenuOpen
          ? "border-b bg-background"
          : showNavbarBlur
            ? "backdrop-blur supports-backdrop-filter:bg-background/60"
            : "backdrop-blur-0 supports-backdrop-filter:bg-background/0"
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex sm:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="relative"
              aria-label={isMenuOpen ? "Close menu" : "Open menu"}
            >
              <motion.div
                animate={{ rotate: isMenuOpen ? 90 : 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                {isMenuOpen ? <X /> : <Menu />}
              </motion.div>
            </Button>
          </div>
          <div className="flex sm:hidden">
            <Link to="/" className="flex items-center gap-2 font-light tracking-tighter text-lg">
              <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
                <Logo size={16} />
              </span>
              Rackline
            </Link>
          </div>
          <div className="hidden items-center space-x-1 lg:space-x-2 sm:flex">
            <Link to="/" className="mr-2 flex items-center gap-2 font-light tracking-tighter text-2xl lg:mr-4">
              <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
                <Logo size={18} />
              </span>
              Rackline
            </Link>

            {menuItems.map((item) => (
              <Button key={item.name} asChild variant="ghost" size="sm">
                <Link to={item.href}>{item.name}</Link>
              </Button>
            ))}

            {navGroups.map((group) => (
              <DropdownMenu key={group.label}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {group.label}
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-96 w-80 overflow-y-auto">
                  {group.items.map((item) => (
                    <DropdownMenuItem key={item.path} asChild className="items-start py-2">
                      <Link to={item.path}>
                        <div className="font-medium leading-snug">{item.name}</div>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  Product
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-80">
                {productItems.map((item) => (
                  <DropdownMenuItem key={item.name} asChild className="items-start gap-2 py-2">
                    <Link to={item.href}>
                      <item.icon className="mt-0.5" />
                      <div>
                        <div className="font-semibold">{item.name}</div>
                        <div className="text-sm text-muted-foreground">{item.description}</div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center space-x-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:flex">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild className="hidden sm:flex" size="sm">
              <Link to="/signup">Open a warehouse</Link>
            </Button>
            <ModeToggle />
          </div>
        </div>
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden sm:hidden"
            >
              <motion.div
                initial={{ y: -20 }}
                animate={{ y: 0 }}
                exit={{ y: -20 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="max-h-[70vh] space-y-1 overflow-y-auto px-2 pt-2 pb-3"
              >
                {menuItems.map((item) => (
                  <Link
                    key={item.name}
                    to={item.href}
                    className="block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-muted"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {item.name}
                  </Link>
                ))}
                {navGroups.map((group) => (
                  <div key={group.label} className="pt-2">
                    <p className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {group.label}
                    </p>
                    {group.items.slice(0, 6).map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted"
                        onClick={() => setIsMenuOpen(false)}
                      >
                        {item.name}
                      </Link>
                    ))}
                  </div>
                ))}
                <div className="flex flex-col gap-2 px-3 pt-2">
                  <Button asChild variant="outline" onClick={() => setIsMenuOpen(false)}>
                    <Link to="/login">Sign in</Link>
                  </Button>
                  <Button asChild onClick={() => setIsMenuOpen(false)}>
                    <Link to="/signup">Open a warehouse</Link>
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
}
