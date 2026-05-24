import {
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  useAuth,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { FormEvent, useEffect, useLayoutEffect, useMemo, useState } from "react";

import { getConnection, setControlPlaneAuthTokenGetter } from "@/polymet/lib/control-plane-api";
import {
  buildChooseOrganizationTaskUrl,
  buildDashboardUrl,
  getSanitizedSignedOutAuthUrl,
  isChooseOrganizationTaskDestination,
} from "@/polymet/lib/dashboard-url";
import { storeOneTimeApiKeys } from "@/polymet/lib/one-time-api-keys";
import WasupPrototype from "@/polymet/prototypes/wasup-prototype";

const clerkAppearance = {
  variables: {
    colorPrimary: "#00c853",
    colorBackground: "transparent",
    colorText: "#f6fff8",
    colorTextSecondary: "rgba(246, 255, 248, 0.55)",
    colorInputBackground: "rgba(255, 255, 255, 0.055)",
    colorInputText: "#f6fff8",
    colorDanger: "#ff7a7a",
    colorSuccess: "#00e676",
    borderRadius: "12px",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full bg-transparent shadow-none",
    card: "w-full bg-transparent shadow-none border-0 p-0 gap-4",
    header: "hidden",
    main: "flex w-full flex-col gap-4",
    form: "flex w-full flex-col gap-3",
    formField: "gap-2",
    socialButtonsBlockButton:
      "!flex !h-[50px] !w-full !max-w-none !items-center !justify-center !gap-2 !rounded-[10px] !border !border-white/12 !bg-white/[0.055] !px-4 !text-white !shadow-none !transition hover:!border-[#00ff6a]/35 hover:!bg-white/[0.08]",
    socialButtonsBlockButtonText:
      "!m-0 !flex-none !text-center text-sm font-medium text-white/85",
    dividerRow: "my-0",
    dividerLine: "bg-white/10",
    dividerText: "px-3 text-xs lowercase text-white/35",
    formFieldLabel:
      "text-xs font-medium uppercase tracking-[0.16em] text-white/45",
    formFieldInput:
      "!h-[50px] !w-full !max-w-none !rounded-[10px] !border !border-white/12 !bg-[#0b0f0d] !px-4 !text-white !shadow-none placeholder:!text-white/25 focus:!border-[#00ff6a]/70 focus:!ring-[#00ff6a]/20",
    formFieldInputShowPasswordButton: "text-white/40 hover:text-[#00e676]",
    formFieldErrorText: "text-[#ff8a8a]",
    formFieldSuccessText: "text-[#00e676]",
    formFieldAction: "text-white/45 hover:text-[#00e676]",
    formButtonPrimary:
      "!h-[50px] !w-full !max-w-none !rounded-[10px] !bg-[#00c853] !text-black !font-semibold !shadow-[0_10px_26px_rgba(0,200,83,0.18)] !transition hover:!bg-[#00e676] focus:!ring-[#00ff6a]/30",
    footer: "hidden",
    footerAction: "hidden",
    footerActionText: "text-white/45",
    footerActionLink: "font-semibold text-[#00e676] hover:text-[#7cffaa]",
    footerPages: "hidden",
    identityPreview: "!rounded-[10px] !border !border-white/12 !bg-white/[0.055]",
    identityPreviewText: "text-white/85",
    identityPreviewEditButton: "text-[#00e676]",
    alternativeMethodsBlockButton:
      "!rounded-[10px] !border-white/12 !bg-white/[0.055] !text-white hover:!bg-white/[0.08]",
    alert: "rounded-2xl border border-white/10 bg-white/[0.05]",
    alertText: "text-white/70",
    otpCodeFieldInput:
      "rounded-2xl border-white/12 bg-black/35 text-white focus:border-[#00ff6a]",
  },
} as const;

const loginClerkRadiusOverride = `
[data-wasup-login] .wasup-login-clerk {
  --clerk-border-radius: 10px !important;
  --cl-radius: 10px !important;
}

[data-wasup-login] .wasup-login-clerk :is(button, input, [class*="cl-"]) {
  border-radius: 10px !important;
}

[data-wasup-login] .wasup-login-clerk [class*="cl-formFieldInput"] {
  height: 50px !important;
  min-height: 50px !important;
}

[data-wasup-login] .wasup-login-clerk [class*="cl-formButtonPrimary"],
[data-wasup-login] .wasup-login-clerk [class*="cl-socialButtonsBlockButton"] {
  height: 50px !important;
  min-height: 50px !important;
  width: 100% !important;
}
`;

type InvitationAuthMode = "sign-in" | "sign-up";

type InvitationContext = {
  ticket: string;
  status: string;
  organizationId: string;
  isInvitationRoute: boolean;
};

const PENDING_INVITATION_ORG_KEY = "wasup.pendingInvitationOrgId";

export default function WasupPrototypeRender() {
  return (
    <>
      <SignedOut>
        <SignedOutDashboard />
      </SignedOut>
      <SignedIn>
        <SignedInDashboard />
      </SignedIn>
    </>
  );
}

function SignedInDashboard() {
  const { getToken, isLoaded } = useAuth();
  const { isLoaded: orgLoaded, organization } = useOrganization();
  const invitationContext = getInvitationContextFromUrl();
  const pendingInvitationOrgId = getPendingInvitationOrgId();

  useLayoutEffect(() => {
    if (!isLoaded) return;
    setControlPlaneAuthTokenGetter(() => getToken());
    return () => setControlPlaneAuthTokenGetter(null);
  }, [getToken, isLoaded]);

  if (!isLoaded || !orgLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="rounded-2xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground shadow-lg">
          Loading secure dashboard...
        </div>
      </div>
    );
  }

  if (invitationContext?.isInvitationRoute || pendingInvitationOrgId) {
    return (
      <ThemedInvitationSetup
        targetOrganizationId={invitationContext?.organizationId || pendingInvitationOrgId}
      />
    );
  }

  if (!organization || isClerkChooseOrganizationTask()) {
    return <ThemedOrganizationSetup />;
  }

  return <WasupPrototype />;
}

function SignedOutDashboard() {
  const [authMode, setAuthMode] = useState<InvitationAuthMode>(() => getInitialAuthMode());
  const [normalizingInvitationRoute, setNormalizingInvitationRoute] = useState(() =>
    needsInvitationUrlNormalization(),
  );
  const [normalizingTaskRoute, setNormalizingTaskRoute] = useState(() =>
    !needsInvitationUrlNormalization() && needsSignedOutAuthUrlNormalization(),
  );
  const [authUrlVersion, setAuthUrlVersion] = useState(0);
  const invitationContext = getInvitationContextFromUrl();
  const isInvitationFlow = Boolean(invitationContext?.ticket || invitationContext?.isInvitationRoute);
  const redirectAfterAuthUrl = isInvitationFlow
    ? buildDashboardUrl("/accept-invitation")
    : buildDashboardUrl("/connection");

  useLayoutEffect(() => {
    if (!normalizingInvitationRoute) return;
    normalizeInvitationUrl();
    rememberPendingInvitation(getInvitationContextFromUrl());
    setAuthMode(getInitialAuthMode());
    setAuthUrlVersion((version) => version + 1);
    setNormalizingInvitationRoute(false);
  }, [normalizingInvitationRoute]);

  useLayoutEffect(() => {
    if (!normalizingTaskRoute) return;
    normalizeSignedOutAuthUrl();
    setAuthMode("sign-up");
    setAuthUrlVersion((version) => version + 1);
    setNormalizingTaskRoute(false);
  }, [normalizingTaskRoute]);

  useEffect(() => {
    const handleHashChange = () => {
      if (normalizeInvitationUrl()) {
        rememberPendingInvitation(getInvitationContextFromUrl());
        setAuthMode(getInitialAuthMode());
        setAuthUrlVersion((version) => version + 1);
        return;
      }

      rememberPendingInvitation(getInvitationContextFromUrl());
      if (normalizeSignedOutAuthUrl()) {
        setAuthMode(getInitialAuthMode());
        setAuthUrlVersion((version) => version + 1);
        return;
      }
      setAuthMode(getInitialAuthMode());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    rememberPendingInvitation(invitationContext);
  }, [invitationContext?.organizationId, invitationContext?.ticket]);

  if (normalizingInvitationRoute || normalizingTaskRoute) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-black text-white">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-4 text-sm text-white/55">
          Loading Wasup sign-up...
        </div>
      </main>
    );
  }

  return (
    <main
      data-wasup-login="premium-phone-ai-v9"
      className="relative flex min-h-svh items-center justify-center overflow-hidden bg-black px-3 py-4 text-white sm:px-6 sm:py-6 lg:px-8"
    >
      <style>{loginClerkRadiusOverride}</style>
      <div className="absolute left-[-16rem] top-[-14rem] h-[36rem] w-[36rem] rounded-full bg-[#00ff6a]/20 blur-[130px]" />
      <div className="absolute bottom-[-15rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-[#00d5ff]/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,255,106,0.10),transparent_36%),linear-gradient(180deg,#070a08_0%,#000_62%)]" />

      <section className="relative grid w-full max-w-6xl rounded-[1.35rem] border border-white/10 bg-[#070908]/92 p-2 shadow-[0_34px_110px_rgba(0,0,0,0.72)] ring-1 ring-[#00ff6a]/10 backdrop-blur-xl md:grid-cols-[0.86fr_1.14fr] lg:rounded-[2rem]">
        <div className="flex min-h-[auto] items-center justify-center px-4 py-7 sm:px-8 sm:py-9 md:min-h-[560px] lg:px-12">
          <div className="w-full max-w-[360px] sm:max-w-[380px]">
            <div className="mb-5 sm:mb-6">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-[#00e676]/70">
                dev.wasup.co
              </p>
              <h1 className="mt-3 text-[2rem] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-[2.65rem]">
                {isInvitationFlow
                  ? "Accept your Wasup invite"
                  : authMode === "sign-up"
                    ? "Create your workspace"
                    : "Welcome back"}
              </h1>
              <p className="mt-3 max-w-xs text-sm leading-6 text-white/50">
                {isInvitationFlow
                  ? "Use the email address that received the invite, then we will open the right workspace."
                  : authMode === "sign-up"
                    ? "Start managing WhatsApp AI support from a premium customer dashboard."
                    : "Sign in to manage your AI customer workspace."}
              </p>
            </div>

            <div className="wasup-login-clerk flex w-full min-h-[280px] flex-col gap-4 [&_.cl-rootBox]:relative [&_.cl-rootBox]:w-full [&_.cl-cardBox]:w-full [&_.cl-card]:relative [&_.cl-card]:flex [&_.cl-card]:w-full [&_.cl-card]:flex-col [&_.cl-card]:gap-4" key={`${authMode}-${authUrlVersion}`}>
              {authMode === "sign-up" ? (
                <SignUp
                  routing="hash"
                  oauthFlow="popup"
                  appearance={clerkAppearance}
                  signInUrl={buildDashboardUrl("/sign-in")}
                  fallbackRedirectUrl={redirectAfterAuthUrl}
                  forceRedirectUrl={redirectAfterAuthUrl}
                />
              ) : (
                <SignIn
                  routing="hash"
                  oauthFlow="popup"
                  appearance={clerkAppearance}
                  signUpUrl={buildDashboardUrl("/sign-up")}
                  fallbackRedirectUrl={redirectAfterAuthUrl}
                  forceRedirectUrl={redirectAfterAuthUrl}
                />
              )}
              {isInvitationFlow ? (
                <div className="mt-5 rounded-xl border border-[#00ff6a]/15 bg-[#00ff6a]/[0.045] px-4 py-3 text-center text-sm text-white/55">
                  This invite stays inside Wasup. Clerk will return you to the dashboard after auth.
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-center text-sm text-white/55">
                  {authMode === "sign-up" ? "Already have an account?" : "New to Wasup?"}{" "}
                  <a
                    href={authMode === "sign-up" ? "#/sign-in" : "#/sign-up"}
                    className="font-semibold text-[#00e676] transition hover:text-[#7cffaa]"
                  >
                    {authMode === "sign-up" ? "Sign in" : "Sign up"}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-[360px] bg-black/20 md:min-h-[560px]">
          <PhoneAiVisual />
        </div>
      </section>
    </main>
  );
}

function ThemedInvitationSetup({
  targetOrganizationId,
}: {
  targetOrganizationId: string;
}) {
  const { organization } = useOrganization();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: {
      pageSize: 50,
    },
  });
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!isLoaded || !setActive || opening || userMemberships.isLoading) return;

    const memberships = userMemberships.data ?? [];
    const targetMembership = targetOrganizationId
      ? memberships.find((membership) => membership.organization.id === targetOrganizationId)
      : memberships[0];
    const activeOrganizationId = organization?.id;
    const organizationId =
      targetMembership?.organization.id ||
      (targetOrganizationId && activeOrganizationId === targetOrganizationId ? activeOrganizationId : "");

    if (!organizationId) {
      setError("We could not find the invited workspace on this account yet. Reopen the invite link and try again.");
      return;
    }

    const openInvitedWorkspace = async () => {
      setOpening(true);
      setError("");
      try {
        if (activeOrganizationId !== organizationId) {
          await setActive({ organization: organizationId });
        }
        const connection = await getConnection();
        storeOneTimeApiKeys(connection.organization.id, connection.oneTimeApiKeys);
        clearPendingInvitation();
        window.location.replace(buildDashboardUrl("/connection"));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not open the invited workspace.");
        setOpening(false);
      }
    };

    void openInvitedWorkspace();
  }, [
    isLoaded,
    opening,
    organization?.id,
    setActive,
    targetOrganizationId,
    userMemberships.data,
    userMemberships.isLoading,
  ]);

  return (
    <main
      data-wasup-login="premium-phone-ai-v9"
      className="relative flex min-h-svh items-center justify-center overflow-hidden bg-black px-3 py-4 text-white sm:px-6 sm:py-6 lg:px-8"
    >
      <style>{loginClerkRadiusOverride}</style>
      <div className="absolute left-[-16rem] top-[-14rem] h-[36rem] w-[36rem] rounded-full bg-[#00ff6a]/20 blur-[130px]" />
      <div className="absolute bottom-[-15rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-[#00d5ff]/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,255,106,0.10),transparent_36%),linear-gradient(180deg,#070a08_0%,#000_62%)]" />

      <section className="relative grid w-full max-w-6xl rounded-[1.35rem] border border-white/10 bg-[#070908]/92 p-2 shadow-[0_34px_110px_rgba(0,0,0,0.72)] ring-1 ring-[#00ff6a]/10 backdrop-blur-xl md:grid-cols-[0.86fr_1.14fr] lg:rounded-[2rem]">
        <div className="flex min-h-[auto] items-center justify-center px-4 py-7 sm:px-8 sm:py-9 md:min-h-[560px] lg:px-12">
          <div className="w-full max-w-[390px]">
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-[#00e676]/70">
              dev.wasup.co
            </p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-[2.65rem]">
              Opening your workspace
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/50">
              Your invitation was accepted. We are switching you into the right Wasup workspace.
            </p>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/55">
              {error ? (
                <div className="rounded-xl border border-[#ff7a7a]/25 bg-[#ff7a7a]/10 px-3 py-2 text-[#ffb1b1]">
                  {error}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#00e676]" />
                  <span>Finalizing your organization access...</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="min-h-[360px] bg-black/20 md:min-h-[560px]">
          <PhoneAiVisual />
        </div>
      </section>
    </main>
  );
}

function ThemedOrganizationSetup() {
  const { user } = useUser();
  const {
    isLoaded,
    createOrganization,
    setActive,
    userMemberships,
  } = useOrganizationList({
    userMemberships: {
      pageSize: 10,
    },
  });
  const defaultName = useMemo(() => {
    const firstName = user?.firstName?.trim();
    if (firstName) return `${firstName}'s Workspace`;
    const email = user?.primaryEmailAddress?.emailAddress?.split("@")[0]?.replace(/[._-]+/g, " ");
    return email ? `${titleCase(email)} Workspace` : "Wasup Workspace";
  }, [user]);
  const [workspaceName, setWorkspaceName] = useState(defaultName);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setWorkspaceName((current) => current || defaultName);
  }, [defaultName]);

  const memberships = userMemberships.data ?? [];
  const canSubmit = isLoaded && !!createOrganization && !!setActive && workspaceName.trim().length > 1;

  const finishSetup = async (organizationId: string) => {
    if (!setActive) return;
    await setActive({ organization: organizationId });
    const connection = await getConnection();
    storeOneTimeApiKeys(connection.organization.id, connection.oneTimeApiKeys);
    window.location.replace(buildDashboardUrl("/connection"));
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !createOrganization) return;

    setSubmitting(true);
    setError("");
    try {
      const organization = await createOrganization({
        name: workspaceName.trim(),
        slug: buildClerkOrgSlug(workspaceName),
      });
      await finishSetup(organization.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create your workspace.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitExisting = async (organizationId: string) => {
    if (!isLoaded || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await finishSetup(organizationId);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open that workspace.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      data-wasup-login="premium-phone-ai-v9"
      className="relative flex min-h-svh items-center justify-center overflow-hidden bg-black px-3 py-4 text-white sm:px-6 sm:py-6 lg:px-8"
    >
      <style>{loginClerkRadiusOverride}</style>
      <div className="absolute left-[-16rem] top-[-14rem] h-[36rem] w-[36rem] rounded-full bg-[#00ff6a]/20 blur-[130px]" />
      <div className="absolute bottom-[-15rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-[#00d5ff]/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,255,106,0.10),transparent_36%),linear-gradient(180deg,#070a08_0%,#000_62%)]" />

      <section className="relative grid w-full max-w-6xl rounded-[1.35rem] border border-white/10 bg-[#070908]/92 p-2 shadow-[0_34px_110px_rgba(0,0,0,0.72)] ring-1 ring-[#00ff6a]/10 backdrop-blur-xl md:grid-cols-[0.86fr_1.14fr] lg:rounded-[2rem]">
        <div className="flex min-h-[auto] items-center justify-center px-4 py-7 sm:px-8 sm:py-9 md:min-h-[560px] lg:px-12">
          <div className="w-full max-w-[390px]">
            <div className="mb-5 sm:mb-6">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-[#00e676]/70">
                dev.wasup.co
              </p>
              <h1 className="mt-3 text-[2rem] font-semibold leading-[1.05] tracking-[-0.045em] text-white sm:text-[2.65rem]">
                Set up your workspace
              </h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-white/50">
                Create the customer workspace that owns your WhatsApp AI instances.
              </p>
            </div>

            <form onSubmit={submitCreate} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div>
                <label
                  htmlFor="workspace-name"
                  className="text-xs font-medium uppercase tracking-[0.16em] text-white/45"
                >
                  Workspace name
                </label>
                <input
                  id="workspace-name"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  disabled={submitting || !isLoaded}
                  className="mt-2 h-[50px] w-full rounded-[10px] border border-white/12 bg-[#0b0f0d] px-4 text-sm text-white shadow-none outline-none placeholder:text-white/25 focus:border-[#00ff6a]/70 focus:ring-2 focus:ring-[#00ff6a]/20 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="Acme Support"
                  autoComplete="organization"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-[#ff7a7a]/25 bg-[#ff7a7a]/10 px-3 py-2 text-sm text-[#ffb1b1]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="flex h-[50px] w-full items-center justify-center rounded-[10px] bg-[#00c853] px-4 text-sm font-semibold text-black shadow-[0_10px_26px_rgba(0,200,83,0.18)] transition hover:bg-[#00e676] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Setting up workspace..." : "Create workspace"}
              </button>

              <p className="text-xs leading-5 text-white/40">
                We will create your Clerk organization, link it to the Wasup control plane,
                and start workspace provisioning.
              </p>
            </form>

            {memberships.length > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/45">
                  Existing organizations
                </p>
                <div className="mt-3 space-y-2">
                  {memberships.map((membership) => (
                    <button
                      key={membership.id}
                      type="button"
                      onClick={() => submitExisting(membership.organization.id)}
                      disabled={submitting || !isLoaded}
                      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left text-sm text-white/75 transition hover:border-[#00ff6a]/35 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{membership.organization.name}</span>
                      <span className="text-xs text-[#00e676]">Open</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white/50">
              Landed here from Clerk setup? You are in the right place. This page replaces
              Clerk&apos;s default organization task with the Wasup setup flow.
            </div>
          </div>
        </div>

        <div className="min-h-[360px] bg-black/20 md:min-h-[560px]">
          <PhoneAiVisual />
        </div>
      </section>
    </main>
  );
}

function PhoneAiVisual() {
  return (
    <div className="relative flex h-full min-h-[360px] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_48%,rgba(0,255,106,0.16),transparent_38%),radial-gradient(circle_at_80%_20%,rgba(0,213,255,0.08),transparent_30%),linear-gradient(90deg,rgba(7,9,8,0.12),#000_18%,#000_100%)] p-5 md:min-h-[560px] md:p-8 lg:p-10">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-[#070908] to-transparent" />
      <div className="pointer-events-none absolute inset-x-8 bottom-6 h-24 rounded-full bg-[#00ff6a]/10 blur-3xl" />
      <img
        src="/wasup-login-phone.png"
        alt="Phone displaying a WhatsApp AI assistant interface"
        width={1024}
        height={537}
        className="relative z-10 h-auto max-h-[320px] w-full max-w-[560px] object-contain drop-shadow-[0_28px_70px_rgba(0,0,0,0.58)] md:max-h-[500px]"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,transparent_28%,rgba(0,0,0,0.12)_100%)]" />
    </div>
  );
}

function getInitialAuthMode(): InvitationAuthMode {
  const invitationContext = getInvitationContextFromUrl();
  if (invitationContext?.status === "sign_up") return "sign-up";
  if (invitationContext?.status === "sign_in") return "sign-in";
  return window.location.hash.startsWith("#/sign-up") ? "sign-up" : "sign-in";
}

function isClerkChooseOrganizationTask() {
  return isChooseOrganizationTaskDestination(window.location.href);
}

function needsSignedOutAuthUrlNormalization() {
  if (getInvitationContextFromUrl()?.isInvitationRoute) return false;
  const sanitizedAuthUrl = getSanitizedSignedOutAuthUrl();
  return isClerkChooseOrganizationTask() || Boolean(sanitizedAuthUrl && sanitizedAuthUrl !== window.location.href);
}

function normalizeSignedOutAuthUrl() {
  if (getInvitationContextFromUrl()?.isInvitationRoute) return false;

  if (isClerkChooseOrganizationTask()) {
    const targetUrl = buildChooseOrganizationTaskUrl(new URLSearchParams(window.location.search));
    window.history.replaceState(null, "", targetUrl);
    return true;
  }

  const sanitizedAuthUrl = getSanitizedSignedOutAuthUrl();
  if (sanitizedAuthUrl && sanitizedAuthUrl !== window.location.href) {
    window.history.replaceState(null, "", sanitizedAuthUrl);
    return true;
  }

  return false;
}

function getInvitationContextFromUrl(): InvitationContext | null {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = getHashSearchParams();
  const getParam = (name: string) => searchParams.get(name) || hashParams.get(name) || "";
  const ticket = getParam("__clerk_ticket");
  const status = getParam("__clerk_status");
  const organizationId = getParam("wasup_org");
  const flow = getParam("wasup_flow");
  const isInvitationRoute = window.location.hash.startsWith("#/accept-invitation") || flow === "accept-invitation";

  if (!ticket && !status && !organizationId && !isInvitationRoute) return null;

  return {
    ticket,
    status,
    organizationId,
    isInvitationRoute,
  };
}

function needsInvitationUrlNormalization() {
  const hashParams = getHashSearchParams();
  return Boolean(hashParams.get("__clerk_ticket") || hashParams.get("__clerk_status") || hashParams.get("wasup_org"));
}

function normalizeInvitationUrl() {
  const hashParams = getHashSearchParams();
  if (!needsInvitationUrlNormalization()) return false;

  const url = new URL(window.location.href);
  for (const key of ["__clerk_ticket", "__clerk_status", "wasup_flow", "wasup_org"]) {
    const value = hashParams.get(key);
    if (value && !url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  url.hash = "/accept-invitation";
  window.history.replaceState(null, "", url.toString());
  return true;
}

function getHashSearchParams() {
  const queryStart = window.location.hash.indexOf("?");
  if (queryStart === -1) return new URLSearchParams();
  return new URLSearchParams(window.location.hash.slice(queryStart + 1));
}

function rememberPendingInvitation(context: InvitationContext | null) {
  if (!context?.organizationId) return;
  window.sessionStorage.setItem(PENDING_INVITATION_ORG_KEY, context.organizationId);
}

function getPendingInvitationOrgId() {
  return window.sessionStorage.getItem(PENDING_INVITATION_ORG_KEY) || "";
}

function clearPendingInvitation() {
  window.sessionStorage.removeItem(PENDING_INVITATION_ORG_KEY);
}

function buildClerkOrgSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return `${base || "wasup-workspace"}-${Date.now().toString(36).slice(-6)}`;
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
