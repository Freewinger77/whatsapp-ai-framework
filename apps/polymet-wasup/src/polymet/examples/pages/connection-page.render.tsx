import { BrowserRouter } from "react-router-dom";
import { ConnectionPage } from "@/polymet/pages/connection-page";
import { MainLayout } from "@/polymet/layouts/main-layout";

export default function ConnectionPageRender() {
  return (
    <BrowserRouter>
      <MainLayout>
        <ConnectionPage />
      </MainLayout>
    </BrowserRouter>
  );
}
