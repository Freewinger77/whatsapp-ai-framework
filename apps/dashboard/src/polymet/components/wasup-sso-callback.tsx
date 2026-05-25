import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";

import { buildDashboardUrl } from "@/polymet/lib/dashboard-url";

export function WasupSsoCallback() {
  const redirectUrl = buildDashboardUrl("/connection");

  return (
    <main className="flex min-h-svh items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#070908]/92 px-6 py-5 text-center shadow-[0_34px_110px_rgba(0,0,0.72)]">
        <p className="wasup-eyebrow text-[#00e676]/70">
          dev.wasup.co
        </p>
        <h1 className="wasup-display-headline mt-3 text-2xl text-white sm:text-3xl">Finishing Google sign-in</h1>
        <p className="mt-3 font-sans text-sm text-white/55">Hold on while we secure your session.</p>
        <div className="mt-5">
          <AuthenticateWithRedirectCallback
            signInFallbackRedirectUrl={redirectUrl}
            signUpFallbackRedirectUrl={redirectUrl}
          />
        </div>
      </div>
    </main>
  );
}
