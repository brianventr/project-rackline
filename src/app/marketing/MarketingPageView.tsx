import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LandingNavbar } from "../landing/navbar";
import { LandingFooter } from "../landing/footer";
import {
  relatedPages,
  type MarketingPage,
} from "@/domain/marketing-pages";
import { DocumentMeta } from "./DocumentMeta";

export function MarketingPageView({ page }: { page: MarketingPage }) {
  const related = relatedPages(page);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background">
      <DocumentMeta title={page.title} description={page.description} path={page.path} />
      <LandingNavbar />
      <main>
        <section className="relative overflow-hidden border-b">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/15 via-background to-background" />
          <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center md:px-8 md:py-32">
            <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
              Rackline WMS · {page.navGroup}
            </p>
            <h1 className="text-pretty bg-linear-to-b from-primary to-foreground bg-clip-text text-4xl font-medium tracking-tighter text-transparent md:text-5xl">
              {page.h1}
            </h1>
            <p className="max-w-2xl text-balance text-lg text-muted-foreground">{page.lede}</p>
            <div className="flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
              <Button asChild className="shadow-lg">
                <Link to="/signup">
                  {page.ctaLabel ?? "Get started"}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/login">Load the Northwind demo</Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Primary search intent: <span className="text-foreground">{page.primaryKeyword}</span>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-16 md:px-8">
          <h2 className="text-center text-xl font-semibold tracking-tight sm:text-2xl">
            What Rackline does here
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            {page.features.map((feature) => (
              <div key={feature.title} className="space-y-2">
                <h3 className="text-lg font-medium tracking-tight">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {page.dayInLife ? (
          <section className="border-y bg-muted/30">
            <div className="mx-auto max-w-3xl px-4 py-16 md:px-8">
              <h2 className="text-xl font-semibold tracking-tight">{page.dayInLife.heading}</h2>
              <p className="mt-4 text-muted-foreground">{page.dayInLife.body}</p>
            </div>
          </section>
        ) : null}

        {page.sections?.map((section) => (
          <section key={section.heading} className="mx-auto max-w-3xl px-4 py-12 md:px-8">
            <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>
            <p className="mt-4 text-muted-foreground">{section.body}</p>
            {section.bullets ? (
              <ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
                {section.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        {page.faqs.length > 0 ? (
          <section className="mx-auto max-w-3xl px-4 py-16 md:px-8">
            <h2 className="text-xl font-semibold tracking-tight">FAQ</h2>
            <dl className="mt-8 space-y-8">
              {page.faqs.map((faq) => (
                <div key={faq.q}>
                  <dt className="font-medium">{faq.q}</dt>
                  <dd className="mt-2 text-muted-foreground">{faq.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section className="border-t">
            <div className="mx-auto max-w-5xl px-4 py-16 md:px-8">
              <h2 className="text-xl font-semibold tracking-tight">Related</h2>
              <div className="mt-8 grid gap-6 sm:grid-cols-3">
                {related.map((rel) => (
                  <Link
                    key={rel.slug}
                    to={rel.path}
                    className="group block space-y-2 transition-opacity hover:opacity-80"
                  >
                    <p className="text-xs tracking-wide text-muted-foreground uppercase">{rel.navGroup}</p>
                    <p className="font-medium tracking-tight group-hover:underline">{rel.h1}</p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <LandingFooter />
    </div>
  );
}
