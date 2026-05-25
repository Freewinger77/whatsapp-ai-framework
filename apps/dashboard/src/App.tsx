import {
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
  useSession,
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
import { WasupAuthForm } from "@/polymet/components/wasup-auth-form";
import { WasupSsoCallback } from "@/polymet/components/wasup-sso-callback";
import WasupPrototype from "@/polymet/prototypes/wasup-prototype";

type InvitationAuthMode = "sign-in" | "sign-up";

type InvitationContext = {
  ticket: string;
  status: string;
  organizationId: string;
  isInvitationRoute: boolean;
};

const PENDING_INVITATION_ORG_KEY = "wasup.pendingInvitationOrgId";

const LOGIN_EYEBROW_CLASS = "wasup-eyebrow text-[#00e676]/70";
const LOGIN_HEADLINE_CLASS = "wasup-display-headline mt-3 text-[2rem] text-white sm:text-[2.65rem]";
const LOGIN_BODY_CLASS = "mt-3 font-sans text-sm leading-6 text-white/50";
const LOGIN_SHELL_CLASS =
  "relative grid w-full max-w-6xl overflow-hidden rounded-[1.35rem] bg-[#070908]/92 shadow-[0_34px_110px_rgba(0,0,0,0.72)] backdrop-blur-xl md:grid-cols-[0.88fr_1.12fr] lg:rounded-[2rem]";
const LOGIN_FORM_COLUMN_CLASS =
  "flex min-h-[auto] items-center justify-center px-4 py-7 sm:px-8 sm:py-9 md:min-h-[560px] lg:px-12";
const LOGIN_VISUAL_COLUMN_CLASS = "relative min-h-[360px] overflow-hidden md:min-h-[560px]";

export default function WasupPrototypeRender() {
  return <AuthGateway />;
}

function AuthGateway() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { session, isLoaded: sessionLoaded } = useSession();
  const clerk = useClerk();
  const { isLoaded: orgLoaded } = useOrganization();

  const authenticated =
    isSignedIn || Boolean(userId) || Boolean(session?.id) || Boolean(clerk.session?.id);
  const authReady = isLoaded && sessionLoaded;

  if (!authReady) {
    return <AuthLoadingScreen message="Loading secure dashboard..." />;
  }

  if (authenticated) {
    if (!orgLoaded) {
      return <AuthLoadingScreen message="Loading your workspace..." />;
    }
    return <SignedInDashboard />;
  }

  if (getHashRouteFromWindow() === "/sso-callback") {
    return <WasupSsoCallback />;
  }

  return <SignedOutDashboard />;
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

  useLayoutEffect(() => {
    if (!isLoaded || !orgLoaded) return;
    if (isClerkChooseOrganizationTask()) {
      window.history.replaceState(null, "", buildDashboardUrl("/connection"));
    }
  }, [isLoaded, orgLoaded]);

  if (!isLoaded || !orgLoaded) {
    return <AuthLoadingScreen message="Loading secure dashboard..." />;
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
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { session, isLoaded: sessionLoaded } = useSession();
  const clerk = useClerk();
  const onChooseOrgTask = isClerkChooseOrganizationTask();
  const [authMode, setAuthMode] = useState<InvitationAuthMode>(() => getInitialAuthMode());
  const [normalizingInvitationRoute, setNormalizingInvitationRoute] = useState(() =>
    needsInvitationUrlNormalization(),
  );
  const [normalizingTaskRoute, setNormalizingTaskRoute] = useState(() =>
    !needsInvitationUrlNormalization() && needsSignedOutAuthUrlNormalization(),
  );
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
    setNormalizingInvitationRoute(false);
  }, [normalizingInvitationRoute]);

  useLayoutEffect(() => {
    if (!normalizingTaskRoute) return;
    normalizeSignedOutAuthUrl();
    setAuthMode(getInitialAuthMode());
    setNormalizingTaskRoute(false);
  }, [normalizingTaskRoute]);

  useEffect(() => {
    const handleHashChange = () => {
      if (normalizeInvitationUrl()) {
        rememberPendingInvitation(getInvitationContextFromUrl());
        setAuthMode(getInitialAuthMode());
        return;
      }

      rememberPendingInvitation(getInvitationContextFromUrl());
      if (normalizeSignedOutAuthUrl()) {
        setAuthMode(getInitialAuthMode());
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

  useEffect(() => {
    if (!isLoaded || !sessionLoaded) return;

    const sessionId = session?.id || clerk.session?.id;
    const alreadyAuthed = isSignedIn || Boolean(userId) || Boolean(sessionId);
    if (!alreadyAuthed || !sessionId) return;

    void clerk
      .setActive({ session: sessionId, redirectUrl: redirectAfterAuthUrl })
      .catch(() => {
        window.location.replace(redirectAfterAuthUrl);
      });
  }, [
    clerk,
    isLoaded,
    isSignedIn,
    redirectAfterAuthUrl,
    session?.id,
    sessionLoaded,
    userId,
  ]);

  if (!isLoaded || !sessionLoaded || normalizingInvitationRoute || normalizingTaskRoute) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-black text-white">
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-6 py-4 text-sm text-white/55">
          {onChooseOrgTask ? "Loading workspace setup..." : "Loading Wasup sign-in..."}
        </div>
      </main>
    );
  }

  if (getHashRouteFromWindow() === "/sso-callback") {
    return <WasupSsoCallback />;
  }

  const effectiveAuthMode: InvitationAuthMode = onChooseOrgTask ? "sign-in" : authMode;
  const showOrgTaskSignIn = onChooseOrgTask && effectiveAuthMode === "sign-in";

  return (
    <main
      data-wasup-login="premium-phone-ai-v9"
      className="relative flex min-h-svh items-center justify-center overflow-hidden bg-black px-3 py-4 text-white sm:px-6 sm:py-6 lg:px-8"
    >
      <div className="absolute left-[-16rem] top-[-14rem] h-[36rem] w-[36rem] rounded-full bg-[#00ff6a]/20 blur-[130px]" />
      <div className="absolute bottom-[-15rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-[#00d5ff]/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,255,106,0.10),transparent_36%),linear-gradient(180deg,#070a08_0%,#000_62%)]" />

      <section className={LOGIN_SHELL_CLASS}>
        <div className={LOGIN_FORM_COLUMN_CLASS}>
          <div className="w-full max-w-[360px] sm:max-w-[380px]">
            <div className="mb-5 sm:mb-6">
              <p className={LOGIN_EYEBROW_CLASS}>
                dev.wasup.co
              </p>
              <h1 className={LOGIN_HEADLINE_CLASS}>
                {isInvitationFlow
                  ? "Accept your Wasup invite"
                  : showOrgTaskSignIn
                    ? "Sign in to set up your workspace"
                    : effectiveAuthMode === "sign-up"
                      ? "Create your workspace"
                      : "Welcome back"}
              </h1>
              <p className={`${LOGIN_BODY_CLASS} max-w-xs`}>
                {isInvitationFlow
                  ? "Use the email address that received the invite, then we will open the right workspace."
                  : showOrgTaskSignIn
                    ? "You are one step away. Sign in, then name the workspace that will own your WhatsApp AI instances."
                    : effectiveAuthMode === "sign-up"
                      ? "Start managing WhatsApp AI support from a premium customer dashboard."
                      : "Sign in to manage your AI customer workspace."}
              </p>
            </div>

            <div className="wasup-login-clerk flex w-full flex-col gap-4" key={effectiveAuthMode}>
              <WasupAuthForm mode={effectiveAuthMode} redirectUrl={redirectAfterAuthUrl} />
              {isInvitationFlow ? (
                <div className="mt-5 rounded-xl border border-[#00ff6a]/15 bg-[#00ff6a]/[0.045] px-4 py-3 text-center text-sm text-white/55">
                  This invite stays inside Wasup. Clerk will return you to the dashboard after auth.
                </div>
              ) : showOrgTaskSignIn ? (
                <div className="mt-5 rounded-xl border border-[#00ff6a]/15 bg-[#00ff6a]/[0.045] px-4 py-3 text-center text-sm text-white/55">
                  After sign-in you&apos;ll create your Wasup organization here — not on a separate Clerk page.
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-center text-sm text-white/55">
                  {effectiveAuthMode === "sign-up" ? "Already have an account?" : "New to Wasup?"}{" "}
                  <a
                    href={effectiveAuthMode === "sign-up" ? "#/sign-in" : "#/sign-up"}
                    className="font-semibold text-[#00e676] transition hover:text-[#7cffaa]"
                  >
                    {effectiveAuthMode === "sign-up" ? "Sign in" : "Sign up"}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={LOGIN_VISUAL_COLUMN_CLASS}>
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
      <div className="absolute left-[-16rem] top-[-14rem] h-[36rem] w-[36rem] rounded-full bg-[#00ff6a]/20 blur-[130px]" />
      <div className="absolute bottom-[-15rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-[#00d5ff]/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,255,106,0.10),transparent_36%),linear-gradient(180deg,#070a08_0%,#000_62%)]" />

      <section className={LOGIN_SHELL_CLASS}>
        <div className={LOGIN_FORM_COLUMN_CLASS}>
          <div className="w-full max-w-[390px]">
            <p className={LOGIN_EYEBROW_CLASS}>
              dev.wasup.co
            </p>
            <h1 className={LOGIN_HEADLINE_CLASS}>
              Opening your workspace
            </h1>
            <p className={`${LOGIN_BODY_CLASS} max-w-sm`}>
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

        <div className={LOGIN_VISUAL_COLUMN_CLASS}>
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
  const hasExistingWorkspace = memberships.length > 0;
  const canSubmit =
    isLoaded &&
    !!createOrganization &&
    !!setActive &&
    workspaceName.trim().length > 1 &&
    !hasExistingWorkspace;

  useEffect(() => {
    if (!isLoaded || submitting || memberships.length !== 1) return;
    void submitExisting(memberships[0].organization.id);
  }, [isLoaded, memberships, submitting]);

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
      <div className="absolute left-[-16rem] top-[-14rem] h-[36rem] w-[36rem] rounded-full bg-[#00ff6a]/20 blur-[130px]" />
      <div className="absolute bottom-[-15rem] right-[-12rem] h-[34rem] w-[34rem] rounded-full bg-[#00d5ff]/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,255,106,0.10),transparent_36%),linear-gradient(180deg,#070a08_0%,#000_62%)]" />

      <section className={LOGIN_SHELL_CLASS}>
        <div className={LOGIN_FORM_COLUMN_CLASS}>
          <div className="w-full max-w-[390px]">
            <div className="mb-5 sm:mb-6">
              <p className={LOGIN_EYEBROW_CLASS}>
                dev.wasup.co
              </p>
              <h1 className={LOGIN_HEADLINE_CLASS}>
                Set up your workspace
              </h1>
              <p className={`${LOGIN_BODY_CLASS} max-w-sm`}>
                Create the customer workspace that owns your WhatsApp AI instances.
              </p>
            </div>

            <form onSubmit={submitCreate} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              {hasExistingWorkspace ? (
                <div className="rounded-xl border border-[#00e676]/20 bg-[#00e676]/10 px-3 py-3 text-sm text-white/75">
                  You already have a Wasup workspace on this account. Open it below — each account gets one workspace.
                </div>
              ) : (
              <>
              <div>
                <label
                  htmlFor="workspace-name"
                  className="wasup-eyebrow text-white/45"
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
              </>
              )}
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

        <div className={LOGIN_VISUAL_COLUMN_CLASS}>
          <PhoneAiVisual />
        </div>
      </section>
    </main>
  );
}

function PhoneAiVisual() {
  return (
    <div className="relative flex h-full min-h-[360px] items-center justify-center overflow-hidden px-2 py-6 md:min-h-[560px] md:px-4 md:py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_58%_42%,rgba(0,255,106,0.14),transparent_52%),radial-gradient(circle_at_82%_18%,rgba(0,213,255,0.08),transparent_40%)]" />
      <div className="pointer-events-none absolute inset-x-6 bottom-4 h-28 rounded-full bg-[#00ff6a]/10 blur-3xl" />
      <img
        src="/wasup-login-phone.png"
        alt="Wasup Dev — phone with code interface"
        width={690}
        height={362}
        className="relative z-10 h-auto w-[min(860px,108%)] max-w-none origin-center scale-[1.3] object-contain drop-shadow-[0_28px_70px_rgba(0,0,0,0.45)]"
      />
    </div>
  );
}

function getHashRouteFromWindow() {
  const hash = window.location.hash.replace(/^#/, "");
  const route = hash.split("?")[0];
  return route.startsWith("/") ? route : `/${route}`;
}

function getInitialAuthMode(): InvitationAuthMode {
  const invitationContext = getInvitationContextFromUrl();
  if (invitationContext?.status === "sign_up") return "sign-up";
  if (invitationContext?.status === "sign_in") return "sign-in";
  if (isClerkChooseOrganizationTask()) return "sign-in";
  const hashRoute = getHashRouteFromWindow();
  if (hashRoute === "/sign-up/tasks/choose-organization") return "sign-in";
  return hashRoute === "/sign-up" ? "sign-up" : "sign-in";
}

function AuthLoadingScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="rounded-2xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground shadow-lg">
        {message}
      </div>
    </div>
  );
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

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
