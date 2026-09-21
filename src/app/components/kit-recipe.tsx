import { useState } from "react";
import type { BomStep } from "../api";
import { SkuThumb } from "./sku-thumb";

export type RecipeComponent = {
  itemId: string;
  sku: string;
  itemName: string;
  qty: number;
  imageUrl?: string | null;
};

export function KitRecipeCard({
  sku,
  itemName,
  imageUrl,
  components,
  steps,
  checkable = false,
}: {
  sku: string;
  itemName: string;
  imageUrl?: string | null;
  components?: RecipeComponent[];
  steps?: BomStep[];
  checkable?: boolean;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const hasSteps = Boolean(steps?.length);
  const hasComponents = Boolean(components?.length);
  if (!hasSteps && !hasComponents && !imageUrl) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <SkuThumb sku={sku} name={itemName} imageUrl={imageUrl} size="lg" />
        <div>
          <p className="font-mono text-sm font-semibold">{sku}</p>
          <p className="text-sm text-muted-foreground">{itemName}</p>
        </div>
      </div>
      {hasSteps ? (
        <ol className="space-y-3">
          {(steps ?? []).map((step) => {
            const photo = step.imageUrl || step.componentImageUrl;
            const partSku = step.componentSku || sku;
            return (
              <li key={step.id} className="flex gap-3">
                {checkable ? (
                  <input
                    type="checkbox"
                    className="mt-2 size-4 shrink-0"
                    checked={Boolean(done[step.id])}
                    onChange={(e) => setDone((current) => ({ ...current, [step.id]: e.target.checked }))}
                    aria-label={`Step ${step.seq}`}
                  />
                ) : (
                  <span className="mt-1 w-5 shrink-0 font-mono text-sm text-muted-foreground">{step.seq}</span>
                )}
                <SkuThumb sku={partSku} name={step.componentName || step.title} imageUrl={photo} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {step.seq}. {step.title || step.body}
                  </p>
                  {step.title && step.body ? <p className="text-sm text-muted-foreground">{step.body}</p> : null}
                  {step.componentSku ? (
                    <p className="font-mono text-xs text-muted-foreground">{step.componentSku}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {hasComponents ? (
        <ul className="space-y-2">
          {(components ?? []).map((line) => (
            <li key={line.itemId} className="flex items-center gap-2 text-sm">
              <SkuThumb sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} size="sm" />
              <span>
                <span className="font-mono">{line.sku}</span> {line.itemName}
              </span>
              <span className="ml-auto font-mono tabular">{line.qty}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
