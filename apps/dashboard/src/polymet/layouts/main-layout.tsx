import { ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppSidebar } from "@/polymet/components/app-sidebar";
import { AppTopbar } from "@/polymet/components/app-topbar";
import { SidebarProvider } from "@/polymet/hooks/use-sidebar";
import { InlineProvisioningSpinner, useWorkspaceState } from "@/polymet/hooks/use-workspace-state";

function MainLayoutInner({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { provisioningActive } = useWorkspaceState();
  const lockedAwayFromConnection = provisioningActive && pathname !== "/connection";

  useEffect(() => {
    if (lockedAwayFromConnection) {
      navigate("/connection", { replace: true });
    }
  }, [lockedAwayFromConnection, navigate]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          <div
            key={pathname}
            className="min-h-full w-full rounded-xl border border-border/60 bg-card p-4 animate-fade-up sm:rounded-2xl sm:p-6 md:p-10"
          >
            {lockedAwayFromConnection ? (
              <div className="grid min-h-[50vh] place-items-center text-center">
                <div>
                  <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-muted">
                    <InlineProvisioningSpinner />
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight">Workspace provisioning</h1>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    We'll email you when it's ready, or you can wait here.
                  </p>
                </div>
              </div>
            ) : (
              children
            )}
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
