import { BrowserRouter } from "react-router-dom";
import { InstancesPage } from "@/polymet/pages/instances-page";
import { MainLayout } from "@/polymet/layouts/main-layout";

export default function InstancesPageRender() {
  return (
    <BrowserRouter>
      <MainLayout>
        <InstancesPage />
      </MainLayout>
    </BrowserRouter>
  );
}
