import { BrowserRouter, Routes, Route } from "react-router-dom";
import { InstanceDetailPage } from "@/polymet/pages/instance-detail-page";
import { MainLayout } from "@/polymet/layouts/main-layout";

export default function InstanceDetailPageRender() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="*"
          element={
            <MainLayout>
              <InstanceDetailPage />
            </MainLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
