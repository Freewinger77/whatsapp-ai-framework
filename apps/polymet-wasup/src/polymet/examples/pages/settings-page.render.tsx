import { BrowserRouter } from "react-router-dom";
import { SettingsPage } from "@/polymet/pages/settings-page";
import { MainLayout } from "@/polymet/layouts/main-layout";

export default function SettingsPageRender() {
  return (
    <BrowserRouter>
      <MainLayout>
        <SettingsPage />
      </MainLayout>
    </BrowserRouter>
  );
}
