import { ArrowRight, BookOpen, Building2, Laptop, ListChecks, ScanLine, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NavigateTo } from "./shared";

const SETUP_PREVIEW = [
  { title: "Your people", detail: "Individual sign-ins, roles, and work assignment.", Icon: Users },
  { title: "Your building", detail: "Receiving, storage, and shipping areas.", Icon: Building2 },
  { title: "Your bays", detail: "Racks, readable names, and printable barcodes.", Icon: ScanLine },
] as const;

/** The first owner screen offers setup immediately; the longer tour remains optional. */
export function OwnerSetupOffer({ onNavigate }: { onNavigate: NavigateTo }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <Laptop aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-semibold">Use a laptop or desktop for initial setup</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The larger screen helps you place racks, review bay labels, and add teammates. Save the iPad or phone
            for floor work once your workspace is ready. You can still continue on this device.
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="h-11" data-quick-setup onClick={() => onNavigate("/welcome")}>
            Start quick setup
            <ArrowRight aria-hidden />
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => onNavigate("/setup/start")}>
            <ListChecks aria-hidden />
            View launch guide
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Working alone? You can leave the team step for later. Additional buildings and advanced workflows stay
          available when you need them.
        </p>
        <Button
          type="button"
          variant="link"
          className="h-11 max-w-full justify-start px-0 text-sm whitespace-normal text-left"
          onClick={() => onNavigate("/setup/start?tab=walkthroughs")}
        >
          <BookOpen aria-hidden className="shrink-0" />
          Browse the workflow walkthroughs
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" aria-label="Quick setup covers">
        {SETUP_PREVIEW.map(({ title, detail, Icon }) => (
          <div key={title} className="rounded-xl border bg-card p-4">
            <Icon aria-hidden className="size-5 text-primary" />
            <p className="mt-3 font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
          </div>
        ))}
      </div>

    </div>
  );
}
