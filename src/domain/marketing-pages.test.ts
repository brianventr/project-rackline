import { describe, expect, it } from "vitest";
import { MARKETING_PAGES, marketingPageByPath, sitemapPaths } from "./marketing-pages";
import { injectMarketingMeta, robotsTxt, sitemapXml } from "./marketing-seo";

describe("marketing pages catalog", () => {
  it("covers wave A–E paths", () => {
    const paths = MARKETING_PAGES.map((p) => p.path);
    expect(paths).toContain("/industries/makers");
    expect(paths).toContain("/use-cases/garage-warehouse");
    expect(paths).toContain("/use-cases/shopify-wms");
    expect(paths).toContain("/use-cases/kickstarter-fulfillment");
    expect(paths).toContain("/use-cases/stocky-replacement");
    expect(paths).toContain("/industries/beauty");
    expect(paths).toContain("/industries/board-games");
    expect(paths).toContain("/compare/vs-shiphero");
  });

  it("resolves by path", () => {
    expect(marketingPageByPath("/industries/makers")?.slug).toBe("makers");
    expect(marketingPageByPath("/industries/makers/")?.slug).toBe("makers");
  });

  it("builds sitemap and robots", () => {
    const xml = sitemapXml("https://example.com");
    expect(xml).toContain("https://example.com/industries/makers");
    expect(robotsTxt("https://example.com")).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(sitemapPaths().length).toBeGreaterThan(10);
  });

  it("injects meta into index html", () => {
    const page = marketingPageByPath("/use-cases/shopify-wms")!;
    const html = `<!doctype html><html><head><title>Rackline WMS</title><meta name="description" content="old" /></head><body></body></html>`;
    const out = injectMarketingMeta(html, page, "https://example.com");
    expect(out).toContain(page.title);
    expect(out).toContain("og:title");
    expect(out).toContain("/use-cases/shopify-wms");
  });
});
