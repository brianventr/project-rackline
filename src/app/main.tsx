import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarConfigProvider } from "@/contexts/sidebar-context";
import { App } from "./App";
import { ConfirmProvider } from "./components/confirm";
import { applyStoredDensity } from "./density";
import { queryClient } from "./query";
import "@/index.css";

applyStoredDensity();

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
