import { useId, useState } from "react";
import { Calculator } from "lucide-react";
import { estimateLaunchCapacity } from "@/domain/launch-guide";

/** A planning estimate from an explicit operating calendar and a measured pilot rate. */
export function LaunchCapacityPlanner() {
  const id = useId();
  const [minimum, setMinimum] = useState("1500");
  const [maximum, setMaximum] = useState("2500");
  const [days, setDays] = useState("10");
  const [rate, setRate] = useState("");
  let result: ReturnType<typeof estimateLaunchCapacity> | null = null;
  let error: string | null = null;
  try {
    result = estimateLaunchCapacity({ minimumOrders: Number(minimum), maximumOrders: Number(maximum), operatingDays: Number(days), ordersPerPersonPerDay: rate.trim() ? Number(rate) : null });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Check the planning inputs.";
  }
  const fields = [
    { key: "minimum", label: "Minimum orders", value: minimum, set: setMinimum, min: "1" },
    { key: "maximum", label: "Maximum orders", value: maximum, set: setMaximum, min: "1" },
    { key: "days", label: "Operating days", value: days, set: setDays, min: "1" },
    { key: "rate", label: "Pilot orders / person / day", value: rate, set: setRate, min: "0.1" },
  ];
  return <section aria-labelledby={`${id}-heading`} className="rounded-xl border bg-card p-5">
    <h3 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold"><Calculator aria-hidden className="size-4 text-primary" />Plan the launch surge</h3>
    <p className="mt-2 text-sm text-muted-foreground">Planning example: 1,500–2,500 backer orders over two weeks. Ten operating days is an assumption; use your actual calendar and measure a complete order in a pilot.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {fields.map((field) => <label key={field.key} htmlFor={`${id}-${field.key}`} className="space-y-1.5 text-xs font-medium"><span>{field.label}</span><input id={`${id}-${field.key}`} type="number" min={field.min} step={field.key === "rate" ? "any" : "1"} inputMode="decimal" value={field.value} onChange={(event) => field.set(event.target.value)} placeholder={field.key === "rate" ? "Enter measured rate" : undefined} className="block h-11 w-full rounded-lg border bg-background px-3 text-base font-normal outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" /></label>)}
    </div>
    <div className="mt-4 rounded-lg bg-muted/50 p-4" aria-live="polite">
      {error ? <p className="text-sm text-destructive">{error}</p> : result ? <><p className="text-lg font-semibold tabular-nums">{result.dailyMinimum.toLocaleString()}–{result.dailyMaximum.toLocaleString()} orders per operating day</p><p className="mt-1 text-sm text-muted-foreground">{result.peopleMinimum !== null && result.peopleMaximum !== null ? `Estimated order-processing team: ${result.peopleMinimum}–${result.peopleMaximum} people at your measured rate.` : "Enter a measured pilot rate to estimate an order-processing team."}</p></> : null}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">This is a planning calculation, not verified capacity. Account separately for unloading, boxes per order, returns, rework, breaks, supervision, and ongoing orders. Record staffing, owners, shift coverage, and the dispatch commitment in the written operating plan.</p>
  </section>;
}
