import { BrowserRouter } from "react-router-dom";
import { AppTopbar } from "@/polymet/components/app-topbar";

export default function AppTopbarRender() {
  return (
    <BrowserRouter>
      <div className="h-screen bg-background">
        <AppTopbar />
      </div>
    </BrowserRouter>
  );
}
