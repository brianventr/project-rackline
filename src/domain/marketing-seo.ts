import { marketingPageByPath, sitemapPaths, type MarketingPage } from "./marketing-pages";

export function robotsTxt(origin: string): string {
  return `User-agent: *
Allow: /
Allow: /industries/
Allow: /use-cases/
Allow: /compare/
Disallow: /api/
Disallow: /today
Disallow: /floor
Disallow: /setup
Disallow: /stock
Disallow: /inbound
Disallow: /outbound
Disallow: /make
Disallow: /analytics
Disallow: /welcome

Sitemap: ${origin}/sitemap.xml
`;
}

export function sitemapXml(origin: string, lastmod = new Date().toISOString().slice(0, 10)): string {
  const urls = sitemapPaths()
    .map(
      (path) => `  <url>
    <loc>${origin}${path === "/" ? "" : path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function injectMarketingMeta(html: string, page: MarketingPage, origin: string): string {
  const title = escapeAttr(page.title);
  const description = escapeAttr(page.description);
  const url = escapeAttr(`${origin}${page.path}`);
  const keywords = escapeAttr(page.keywords.join(", "));
  let out = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  if (/<meta\s+name=["']description["']/i.test(out)) {
    out = out.replace(
      /<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?>/i,
      `<meta name="description" content="${description}" />`,
    );
  } else {
    out = out.replace("</head>", `  <meta name="description" content="${description}" />\n</head>`);
  }
  const extras = `
    <meta name="keywords" content="${keywords}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <link rel="canonical" href="${url}" />
  `;
  return out.replace("</head>", `${extras}</head>`);
}

export function isMarketingSeoPath(pathname: string): boolean {
  if (pathname === "/sitemap.xml" || pathname === "/robots.txt") return true;
  return Boolean(marketingPageByPath(pathname));
}
