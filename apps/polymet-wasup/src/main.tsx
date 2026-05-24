import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";

import App from "./App.tsx";
import "./index.css";
import {
  buildChooseOrganizationTaskUrl,
  buildDashboardUrl,
  normalizeClerkNavigationUrl,
  rescueUnexpectedDashboardPathUrl,
  rescueUnexpectedClerkTaskUrl,
} from "@/polymet/lib/dashboard-url";
import { initializeWasupTheme } from "@/polymet/lib/theme";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const signInUrl = buildDashboardUrl("/sign-in");
const signUpUrl = buildDashboardUrl("/sign-up");
const signedInUrl = buildDashboardUrl("/connection");
const chooseOrganizationTaskUrl = buildChooseOrganizationTaskUrl();

rescueUnexpectedClerkTaskUrl();
rescueUnexpectedDashboardPathUrl();

initializeWasupTheme();

function clerkRouterPush(to: string, metadata?: { windowNavigate: (to: string | URL) => void }) {
  const destination = normalizeClerkNavigationUrl(to);
  if (navigateWithinDashboard(destination, "push")) {
    return;
  }
  if (metadata?.windowNavigate) {
    metadata.windowNavigate(destination);
    return;
  }
  window.location.assign(destination);
}

function clerkRouterReplace(to: string) {
  const destination = normalizeClerkNavigationUrl(to);
  if (navigateWithinDashboard(destination, "replace")) {
    return;
  }
  window.location.replace(destination);
}

function navigateWithinDashboard(destination: string, mode: "push" | "replace") {
  const url = new URL(destination, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) {
    return false;
  }

  const oldUrl = window.location.href;
  if (oldUrl === url.toString()) return true;

  if (mode === "replace") {
    window.history.replaceState(null, "", url.toString());
  } else {
    window.history.pushState(null, "", url.toString());
  }
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: oldUrl, newURL: url.toString() }));
  return true;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider
        publishableKey={clerkPublishableKey}
        signInUrl={signInUrl}
        signUpUrl={signUpUrl}
        signInFallbackRedirectUrl={signedInUrl}
        signUpFallbackRedirectUrl={signedInUrl}
        signInForceRedirectUrl={signedInUrl}
        signUpForceRedirectUrl={signedInUrl}
        afterSignOutUrl={signInUrl}
        taskUrls={{ "choose-organization": chooseOrganizationTaskUrl }}
        routerPush={clerkRouterPush}
        routerReplace={clerkRouterReplace}
      >
        <App />
      </ClerkProvider>
    ) : (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
          <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">Wasup dashboard</p>
          <h1 className="mt-3 text-2xl font-semibold">Authentication is not configured</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Set VITE_CLERK_PUBLISHABLE_KEY for this build to enable customer dashboard sign-in.
          </p>
        </div>
      </div>
    )}
  </StrictMode>,
);
