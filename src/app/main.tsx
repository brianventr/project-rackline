import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarConfigProvider } from "@/contexts/sidebar-context";
import { App } from "./App";
import { ConfirmProvider } from "./components/confirm";
import { applyStoredDensity } from "./density";
import { watchOfflineQueue } from "./offline-queue";
import { queryClient } from "./query";
import { registerAppShell } from "./register-shell";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@/index.css";

applyStoredDensity();
registerAppShell();
watchOfflineQueue();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="rackline-ui-theme">
      <QueryClientProvider client={queryClient}>
        <SidebarConfigProvider>
          <BrowserRouter>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </BrowserRouter>
        </SidebarConfigProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
