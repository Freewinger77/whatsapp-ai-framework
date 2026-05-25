import { BrowserRouter } from "react-router-dom";
import { MainLayout } from "@/polymet/layouts/main-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function MainLayoutRender() {
  return (
    <BrowserRouter>
      <MainLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-72" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </MainLayout>
    </BrowserRouter>
  );
}
