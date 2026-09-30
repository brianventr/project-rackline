import { LandingNavbar } from "../landing/navbar";
import { LandingHero } from "../landing/hero";
import { LandingEcosystems } from "../landing/ecosystems";
import { LandingPartners } from "../landing/partners";
import { LandingFeatures } from "../landing/features";
import { LandingTestimonials } from "../landing/testimonials";
import { LandingStats } from "../landing/stats";
import { LandingPricing } from "../landing/pricing";
import { LandingFaq } from "../landing/faq";
import { LandingFooter } from "../landing/footer";
import { DocumentMeta } from "../marketing/DocumentMeta";

export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background">
      <DocumentMeta
        title="Rackline WMS — Warehouse software for makers who grow into manufacturers"
        description="Cloudflare-native warehouse management. Start in Garage Mode, kit what you sell, pick Shopify orders, and open the full warehouse on the same ledger."
        path="/"
      />
      <LandingNavbar />
      <main className="flex min-h-dvh flex-col">
        <LandingHero />
        <LandingEcosystems />
        <LandingPartners />
        <LandingFeatures />
        <LandingTestimonials />
        <LandingStats />
        <LandingPricing />
        <LandingFaq />
        <LandingFooter />
      </main>
    </div>
  );
}
