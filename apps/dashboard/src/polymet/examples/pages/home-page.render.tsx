import { BrowserRouter } from "react-router-dom";
import { HomePage } from "@/polymet/pages/home-page";
import { MainLayout } from "@/polymet/layouts/main-layout";

export default function HomePageRender() {
  return (
    <BrowserRouter>
      <MainLayout>
        <HomePage />
      </MainLayout>
    </BrowserRouter>
  );
}
