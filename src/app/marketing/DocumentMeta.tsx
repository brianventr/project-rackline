import { useEffect } from "react";

/** Client-side document meta for marketing routes (Worker also injects for crawlers). */
export function DocumentMeta({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", "website");
    const origin = window.location.origin;
    upsertMeta("property", "og:url", `${origin}${path}`);
    return () => {
      document.title = "Rackline WMS";
    };
  }, [title, description, path]);

  return null;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}
