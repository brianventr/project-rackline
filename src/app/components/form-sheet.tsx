import type { FormEvent, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ErrorBanner } from "./ui";

/**
 * Create forms slide in from the right instead of pushing the list down.
 * The submit handler should throw on failure; the sheet stays open and shows the error.
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  busy,
  error,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  onSubmit: () => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
  children: ReactNode;
  wide?: boolean;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    void onSubmit();
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={wide ? "w-full gap-0 sm:max-w-xl" : "w-full gap-0 sm:max-w-md"}>
        <form onSubmit={submit} className="flex h-full min-h-0 flex-col">
          <SheetHeader className="border-b">
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <ErrorBanner error={error ?? null} />
            {children}
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
