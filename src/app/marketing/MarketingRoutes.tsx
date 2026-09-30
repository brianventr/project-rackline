import { Navigate, useParams } from "react-router-dom";
import { marketingPageByPath, marketingPageBySlug } from "@/domain/marketing-pages";
import { MarketingPageView } from "./MarketingPageView";

export function IndustryPage() {
  const { slug } = useParams();
  const page = slug ? marketingPageBySlug(slug) : undefined;
  if (!page || page.kind !== "industry") return <Navigate to="/" replace />;
  return <MarketingPageView page={page} />;
}

export function UseCasePage() {
  const { slug } = useParams();
  const page = slug ? marketingPageBySlug(slug) : undefined;
  if (!page || page.kind !== "use-case") return <Navigate to="/" replace />;
  return <MarketingPageView page={page} />;
}

export function ComparePage() {
  const { slug } = useParams();
  const page = slug ? marketingPageBySlug(slug) : undefined;
  if (!page || page.kind !== "compare") return <Navigate to="/" replace />;
  return <MarketingPageView page={page} />;
}

export function MarketingPathPage({ path }: { path: string }) {
  const page = marketingPageByPath(path);
  if (!page) return <Navigate to="/" replace />;
  return <MarketingPageView page={page} />;
}
