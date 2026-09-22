import { LandingNavbar } from "../landing/navbar";
import { LandingHero } from "../landing/hero";
import { LandingModes } from "../landing/modes";
import { LandingPartners } from "../landing/partners";
import { LandingFeatures } from "../landing/features";
import { LandingTestimonials } from "../landing/testimonials";
import { LandingStats } from "../landing/stats";
import { LandingPricing } from "../landing/pricing";
import { LandingFaq } from "../landing/faq";
import { LandingFooter } from "../landing/footer";

export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background">
      <LandingNavbar />
      <main className="flex min-h-dvh flex-col">
        <LandingHero />
        <LandingModes />
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
