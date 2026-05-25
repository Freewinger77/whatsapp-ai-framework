import { useClerk, useSignIn, useSignUp } from "@clerk/clerk-react";
import { FormEvent, useEffect, useState } from "react";

import { buildDashboardUrl } from "@/polymet/lib/dashboard-url";

type AuthMode = "sign-in" | "sign-up";

type WasupAuthFormProps = {
  mode: AuthMode;
  redirectUrl: string;
};

function getClerkErrorMessage(err: unknown) {
  if (err && typeof err === "object" && "errors" in err) {
    const errors = (err as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
    const first = errors?.[0];
    if (first?.longMessage) return first.longMessage;
    if (first?.message) return first.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function isAlreadySignedInError(err: unknown) {
  return /already signed in/i.test(getClerkErrorMessage(err));
}

export function WasupAuthForm({ mode, redirectUrl }: WasupAuthFormProps) {
  const clerk = useClerk();
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

  const resumeExistingSession = async () => {
    const sessionId = clerk.session?.id;
    const setActive = isSignUp ? setSignUpActive : setSignInActive;
    if (sessionId && setActive) {
      await setActive({ session: sessionId, redirectUrl });
      return;
    }
    window.location.replace(redirectUrl);
  };

  useEffect(() => {
    const sessionId = clerk.session?.id;
    if (!isLoaded || !sessionId) return;
    void clerk.setActive({ session: sessionId, redirectUrl }).catch(() => {
      window.location.replace(redirectUrl);
    });
  }, [clerk, isLoaded, redirectUrl]);

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
      if (isAlreadySignedInError(err)) {
        try {
          await resumeExistingSession();
          return;
        } catch {
          window.location.replace(redirectUrl);
          return;
        }
      }
      setError(getClerkErrorMessage(err) || "Google sign-in failed.");
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
      if (isAlreadySignedInError(err)) {
        try {
          await resumeExistingSession();
          return;
        } catch {
          window.location.replace(redirectUrl);
          return;
        }
      }
      setError(getClerkErrorMessage(err) || "Could not continue with email.");
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
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
