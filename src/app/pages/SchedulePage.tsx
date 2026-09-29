import { Link } from "react-router-dom";
import { Card, PageHeader } from "../components/ui";
import { useApiQuery } from "../query";
import { useWarehouse } from "../warehouse";
import { Skeleton } from "@/components/ui/skeleton";

type ScheduleJob = {
  id: string;
  kind: "kit" | "work_order";
  number: string;
  sku: string;
  name: string;
  remaining: number;
  qty: number;
  qtyCompleted: number;
  status: string;
};

type SchedulePayload = { jobs: ScheduleJob[]; generatedAt: number };

export function SchedulePage() {
  const { warehouseId } = useWarehouse();
  const schedule = useApiQuery<SchedulePayload>(
    `/api/schedule?warehouseId=${encodeURIComponent(warehouseId)}`,
  );

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Make"
        title="Schedule"
        description="Light production board for open kits and work orders — ranked by age and remaining qty. Not finite-capacity MRP."
      />
      {schedule.isLoading ? <Skeleton className="h-40 w-full" /> : null}
      <div className="space-y-2">
        {(schedule.data?.jobs ?? []).map((job, index) => (
          <Card key={job.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">
                #{index + 1} · {job.kind === "kit" ? "Kit" : "Work order"} · {job.status}
              </p>
              <p className="font-medium tracking-tight">
                <span className="font-mono">{job.number}</span> · {job.sku} {job.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {job.qtyCompleted}/{job.qty} complete · {job.remaining} remaining
              </p>
            </div>
            <Link
              className="text-sm underline"
              to={job.kind === "kit" ? `/make/kits/${job.id}` : `/make/work-orders/${job.id}`}
            >
              Open
            </Link>
          </Card>
        ))}
        {schedule.data && schedule.data.jobs.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">No open kits or work orders on this board.</Card>
        ) : null}
      </div>
    </div>
  );
}
