"use client";

import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { useScanner } from "@/app/scanner/ScannerProvider";

export function SiteHeader() {
  const scanner = useScanner();

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 py-3 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <p className="hidden text-sm text-muted-foreground sm:block">Warehouse floor</p>
        <div className="ml-auto flex items-center gap-2">
          {scanner.cameraSupported ? (
            <Button variant="outline" size="sm" onClick={() => scanner.openCamera()}>
              <ScanLine className="size-4" />
              Scan
            </Button>
          ) : (
            <span className="hidden text-xs text-muted-foreground md:inline">Gun scanners work from any screen</span>
          )}
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
