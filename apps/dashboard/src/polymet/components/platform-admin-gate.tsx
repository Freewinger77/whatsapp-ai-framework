import { type ReactNode } from "react";
import { useUser } from "@clerk/clerk-react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { isPlatformAdminEmail } from "@/polymet/lib/platform-admin";

export function PlatformAdminGate({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  if (!isLoaded) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking platform access...
      </div>
    );
  }

  if (!isPlatformAdminEmail(email)) {
    toast.error("Platform admin access required");
    return <Navigate to="/" replace />;
  }

  return children;
}
