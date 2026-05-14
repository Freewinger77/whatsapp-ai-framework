import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AppSidebar } from "@/polymet/components/app-sidebar";
import { AppTopbar } from "@/polymet/components/app-topbar";
import { SidebarProvider } from "@/polymet/hooks/use-sidebar";

function MainLayoutInner({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="flex-1 overflow-y-auto p-6">
          <div
            key={pathname}
            className="min-h-full w-full rounded-2xl border border-border/60 bg-card p-8 md:p-10 animate-fade-up"
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function MainLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <MainLayoutInner>{children}</MainLayoutInner>
    </SidebarProvider>
  );
}
