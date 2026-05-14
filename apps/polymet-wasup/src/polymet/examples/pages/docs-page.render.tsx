import { BrowserRouter } from "react-router-dom";
import { DocsPage } from "@/polymet/pages/docs-page";
import { MainLayout } from "@/polymet/layouts/main-layout";

export default function DocsPageRender() {
  return (
    <BrowserRouter>
      <MainLayout>
        <DocsPage />
      </MainLayout>
    </BrowserRouter>
  );
}
