import { useState } from "react";
import type { BomStep } from "../api";
import { confirmedQty, stepsRequiredMessage, type StepConfirmationQty } from "@/domain/step-confirm";
import { Button, Input } from "./ui";
import { SkuThumb } from "./sku-thumb";

export function stepShortfall(
  steps: BomStep[] | undefined,
  confirmations: StepConfirmationQty[] | undefined,
  qtyCompleted: number,
  postedQty: number,
): string | null {
  if (!steps?.length || postedQty <= 0) return null;
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  const needed = qtyCompleted + postedQty;
  for (const step of ordered) {
    if (confirmedQty(confirmations ?? [], step.id) < needed) {
      return stepsRequiredMessage(step);
    }
  }
  return null;
}

/** How many units an explicit confirm should cover for this complete, capped at the build. */
export function explicitConfirmQty(
  stepId: string,
  confirmations: StepConfirmationQty[] | undefined,
  qtyCompleted: number,
  postedQty: number,
  documentQty: number,
): number {
  const confirmed = confirmedQty(confirmations ?? [], stepId);
  const target = postedQty > 0 ? qtyCompleted + postedQty : documentQty;
  return Math.max(0, Math.min(documentQty, target) - confirmed);
}

export function StepGate({
  steps,
  confirmations,
  qtyCompleted,
  postedQty,
  documentQty,
  onConfirm,
  typedScan = false,
}: {
  steps?: BomStep[];
  confirmations?: StepConfirmationQty[];
  qtyCompleted: number;
  postedQty: number;
  documentQty: number;
  onConfirm: (body: { stepId?: string; code?: string; qty?: number }) => void;
  /** Office: type a component SKU. The floor scan box posts the same call. */
  typedScan?: boolean;
}) {
  const [code, setCode] = useState("");
  if (!steps?.length) return null;
  const needed = postedQty > 0 ? qtyCompleted + postedQty : null;
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Steps</p>
      <ol className="space-y-3">
        {ordered.map((step) => {
          const done = confirmedQty(confirmations ?? [], step.id);
          const photo = step.imageUrl || step.componentImageUrl;
          const cover = explicitConfirmQty(step.id, confirmations, qtyCompleted, postedQty, documentQty);
          const met = needed != null && done >= needed;
          return (
            <li key={step.id} className="flex gap-3">
              <SkuThumb sku={step.componentSku || step.title || "step"} name={step.title || step.body} imageUrl={photo} size="sm" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">
                  {step.seq}. {step.title || step.body}
                </p>
                {step.title && step.body ? <p className="text-sm text-muted-foreground">{step.body}</p> : null}
                <p className="font-mono text-xs text-muted-foreground">
                  {needed != null ? `${Math.min(done, needed)}/${needed} confirmed` : `${done} confirmed`}
                  {step.componentSku ? ` · scan ${step.componentSku}` : ""}
                </p>
                {!step.componentItemId && cover > 0 && !met ? (
                  <Button className="h-11" variant="secondary" onClick={() => onConfirm({ stepId: step.id, qty: cover })}>
                    Confirm {cover}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {typedScan ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = code.trim();
            if (!next) return;
            setCode("");
            onConfirm({ code: next });
          }}
        >
          <Input
            className="h-11 text-base"
            value={code}
            placeholder="Component SKU, barcode, or case"
            aria-label="Component scan"
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" className="h-11" variant="secondary">
            Confirm scan
          </Button>
        </form>
      ) : null}
    </div>
  );
}
