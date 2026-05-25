import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { MainLayout } from "@/polymet/layouts/main-layout";
import { WorkspaceStateProvider } from "@/polymet/hooks/use-workspace-state";
import { HomePage } from "@/polymet/pages/home-page";
import { InstancesPage } from "@/polymet/pages/instances-page";
import { InstanceDetailPage } from "@/polymet/pages/instance-detail-page";
import { ConnectionPage } from "@/polymet/pages/connection-page";
import { PlaygroundPage } from "@/polymet/pages/playground-page";
import { DeepDivePage } from "@/polymet/pages/deep-dive-page";
import { DocsPage } from "@/polymet/pages/docs-page";
import { SettingsPage } from "@/polymet/pages/settings-page";
import { StoragePage } from "@/polymet/pages/storage-page";
import { AdminPage } from "@/polymet/pages/admin-page";
import { PlatformAdminGate } from "@/polymet/components/platform-admin-gate";

export default function WasupPrototype() {
  return (
    <Router>
      <WorkspaceStateProvider>
        <Routes>
          <Route path="/" element={<MainLayout><HomePage /></MainLayout>} />
          <Route path="/instances" element={<MainLayout><InstancesPage /></MainLayout>} />
          <Route path="/instances/:id" element={<MainLayout><InstanceDetailPage /></MainLayout>} />
          <Route path="/connection" element={<MainLayout><ConnectionPage /></MainLayout>} />
          <Route path="/playground" element={<MainLayout><PlaygroundPage /></MainLayout>} />
          <Route path="/deep-dive" element={<MainLayout><DeepDivePage /></MainLayout>} />
          <Route path="/storage" element={<MainLayout><StoragePage /></MainLayout>} />
          <Route path="/docs" element={<MainLayout><DocsPage /></MainLayout>} />
          <Route path="/settings" element={<MainLayout><SettingsPage /></MainLayout>} />
          <Route
            path="/admin"
            element={
              <MainLayout>
                <PlatformAdminGate>
                  <AdminPage />
                </PlatformAdminGate>
              </MainLayout>
            }
          />
          <Route path="*" element={<Navigate to="/connection" replace />} />
        </Routes>
        <Toaster closeButton richColors position="top-center" />
      </WorkspaceStateProvider>
    </Router>
  );
}
