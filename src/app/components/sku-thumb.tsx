import { cn } from "@/lib/utils";

export function skuInitials(sku: string): string {
  const compact = sku.replace(/[^A-Za-z0-9]+/g, " ").trim();
  const parts = compact.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return sku.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

export function SkuThumb({
  sku,
  name,
  imageUrl,
  size = "md",
  className,
}: {
  sku: string;
  name?: string | null;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dim = size === "lg" ? "size-20" : size === "sm" ? "size-8" : "size-12";
  const label = name || sku;
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={label}
        className={cn("shrink-0 rounded-md bg-muted object-cover", dim, className)}
      />
    );
  }
  return (
    <div
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] font-semibold text-muted-foreground",
        dim,
        className,
      )}
    >
      {skuInitials(sku)}
    </div>
  );
}
