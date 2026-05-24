import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { FormEvent, useState } from "react";

import { buildDashboardUrl } from "@/polymet/lib/dashboard-url";

type AuthMode = "sign-in" | "sign-up";

type WasupAuthFormProps = {
  mode: AuthMode;
  redirectUrl: string;
};

export function WasupAuthForm({ mode, redirectUrl }: WasupAuthFormProps) {
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"start" | "password" | "code">("start");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isSignUp = mode === "sign-up";
  const isLoaded = isSignUp ? signUpLoaded : signInLoaded;

  if (!isLoaded) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-center text-sm text-white/55">
        Loading sign-in options...
      </div>
    );
  }

  const finishSession = async (sessionId: string) => {
    const setActive = isSignUp ? setSignUpActive : setSignInActive;
    if (!setActive) throw new Error("Could not activate your session.");
    await setActive({ session: sessionId, redirectUrl });
  };

  const onGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      const authObject = isSignUp ? signUp : signIn;
      if (!authObject) throw new Error("Authentication is not ready yet.");
      await authObject.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: buildDashboardUrl("/sso-callback"),
        redirectUrlComplete: redirectUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
      setLoading(false);
    }
  };

  const onEmailContinue = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignUp) {
        if (!signUp) throw new Error("Sign-up is not ready yet.");
        await signUp.create({ emailAddress: email, password });
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setStep("code");
        setLoading(false);
        return;
      }

      if (!signIn) throw new Error("Sign-in is not ready yet.");
      await signIn.create({ identifier: email });

      const passwordFactor = signIn.supportedFirstFactors?.find((factor) => factor.strategy === "password");
      const emailCodeFactor = signIn.supportedFirstFactors?.find((factor) => factor.strategy === "email_code");

      if (passwordFactor) {
        setStep("password");
        setLoading(false);
        return;
      }

      if (emailCodeFactor && "emailAddressId" in emailCodeFactor) {
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailCodeFactor.emailAddressId,
        });
        setStep("code");
        setLoading(false);
        return;
      }

      throw new Error("No supported sign-in method for this email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue with email.");
      setLoading(false);
    }
  };

  const onPasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (!signIn) throw new Error("Sign-in is not ready yet.");
      const result = await signIn.attemptFirstFactor({ strategy: "password", password });
      if (result.status === "complete" && result.createdSessionId) {
        await finishSession(result.createdSessionId);
        return;
      }
      throw new Error("Password sign-in did not complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect password.");
      setLoading(false);
    }
  };

  const onCodeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignUp) {
        if (!signUp) throw new Error("Sign-up is not ready yet.");
        const result = await signUp.attemptEmailAddressVerification({ code });
        if (result.status === "complete" && result.createdSessionId) {
          await finishSession(result.createdSessionId);
          return;
        }
        throw new Error("Verification did not complete.");
      }

      if (!signIn) throw new Error("Sign-in is not ready yet.");
      const result = await signIn.attemptFirstFactor({ strategy: "email_code", code });
      if (result.status === "complete" && result.createdSessionId) {
        await finishSession(result.createdSessionId);
        return;
      }
      throw new Error("Verification did not complete.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid verification code.");
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4">
      {step === "start" ? (
        <>
          <button
            type="button"
            onClick={onGoogle}
            disabled={loading}
            className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[10px] border border-white/12 bg-white/[0.055] px-4 text-sm font-medium text-white/85 transition hover:border-[#00ff6a]/35 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleMark />
            Continue with Google
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs lowercase text-white/35">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={onEmailContinue} className="flex flex-col gap-3">
            <label className="text-xs font-medium uppercase tracking-[0.16em] text-white/45">
              Email address
            </label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email address"
              required
              className="h-[50px] w-full rounded-[10px] border border-white/12 bg-[#0b0f0d] px-4 text-white placeholder:text-white/25 focus:border-[#00ff6a]/70 focus:outline-none focus:ring-2 focus:ring-[#00ff6a]/20"
            />
            {isSignUp ? (
              <>
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-white/45">
                  Password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Create a password"
                  required
                  minLength={8}
                  className="h-[50px] w-full rounded-[10px] border border-white/12 bg-[#0b0f0d] px-4 text-white placeholder:text-white/25 focus:border-[#00ff6a]/70 focus:outline-none focus:ring-2 focus:ring-[#00ff6a]/20"
                />
              </>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="h-[50px] w-full rounded-[10px] bg-[#00c853] text-sm font-semibold text-black shadow-[0_10px_26px_rgba(0,200,83,0.18)] transition hover:bg-[#00e676] focus:outline-none focus:ring-4 focus:ring-[#00ff6a]/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Continuing..." : isSignUp ? "Create workspace" : "Continue"}
            </button>
          </form>
        </>
      ) : null}

      {step === "password" ? (
        <form onSubmit={onPasswordSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-white/55">Enter the password for {email}</p>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            className="h-[50px] w-full rounded-[10px] border border-white/12 bg-[#0b0f0d] px-4 text-white placeholder:text-white/25 focus:border-[#00ff6a]/70 focus:outline-none focus:ring-2 focus:ring-[#00ff6a]/20"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-[50px] w-full rounded-[10px] bg-[#00c853] text-sm font-semibold text-black shadow-[0_10px_26px_rgba(0,200,83,0.18)] transition hover:bg-[#00e676] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => setStep("start")}
            className="text-sm text-white/45 transition hover:text-[#00e676]"
          >
            Use a different email
          </button>
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={onCodeSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-white/55">Enter the verification code sent to {email}</p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
            required
            className="h-[50px] w-full rounded-[10px] border border-white/12 bg-[#0b0f0d] px-4 text-white placeholder:text-white/25 focus:border-[#00ff6a]/70 focus:outline-none focus:ring-2 focus:ring-[#00ff6a]/20"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-[50px] w-full rounded-[10px] bg-[#00c853] text-sm font-semibold text-black shadow-[0_10px_26px_rgba(0,200,83,0.18)] transition hover:bg-[#00e676] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Verifying..." : "Verify and continue"}
          </button>
          <button
            type="button"
            onClick={() => setStep("start")}
            className="text-sm text-white/45 transition hover:text-[#00e676]"
          >
            Use a different email
          </button>
        </form>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-[#ff7a7a]/25 bg-[#ff7a7a]/10 px-3 py-2 text-sm text-[#ffb1b1]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path
        fill="#EA4335"
        d="M12 10.2v3.6h5.1c-.2 1.2-1.5 3.5-5.1 3.5-3.1 0-5.6-2.5-5.6-5.6S8.9 6.1 12 6.1c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.8 3.7 14.6 2.8 12 2.8 6.9 2.8 2.8 6.9 2.8 12s4.1 9.2 9.2 9.2c5.3 0 8.8-3.7 8.8-9 0-.6-.1-1-.2-1.5H12z"
      />
    </svg>
  );
}
