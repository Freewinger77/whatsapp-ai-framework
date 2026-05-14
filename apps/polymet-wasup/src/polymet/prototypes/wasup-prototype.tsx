import { HashRouter as Router, Routes, Route } from "react-router-dom";
import { MainLayout } from "@/polymet/layouts/main-layout";
import { HomePage } from "@/polymet/pages/home-page";
import { InstancesPage } from "@/polymet/pages/instances-page";
import { InstanceDetailPage } from "@/polymet/pages/instance-detail-page";
import { ConnectionPage } from "@/polymet/pages/connection-page";
import { DeepDivePage } from "@/polymet/pages/deep-dive-page";
import { DocsPage } from "@/polymet/pages/docs-page";
import { SettingsPage } from "@/polymet/pages/settings-page";

export default function WasupPrototype() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainLayout><HomePage /></MainLayout>} />
        <Route path="/instances" element={<MainLayout><InstancesPage /></MainLayout>} />
        <Route path="/instances/:id" element={<MainLayout><InstanceDetailPage /></MainLayout>} />
        <Route path="/connection" element={<MainLayout><ConnectionPage /></MainLayout>} />
        <Route path="/deep-dive" element={<MainLayout><DeepDivePage /></MainLayout>} />
        <Route path="/docs" element={<MainLayout><DocsPage /></MainLayout>} />
        <Route path="/settings" element={<MainLayout><SettingsPage /></MainLayout>} />
      </Routes>
    </Router>
  );
}
