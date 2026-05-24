import { BrowserRouter } from "react-router-dom";
import { AppSidebar } from "@/polymet/components/app-sidebar";

export default function AppSidebarRender() {
  return (
    <BrowserRouter>
      <AppSidebar />
    </BrowserRouter>
  );
}
