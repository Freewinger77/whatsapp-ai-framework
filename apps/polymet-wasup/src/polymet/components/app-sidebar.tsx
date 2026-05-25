import { FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useClerk, useOrganization, useUser } from "@clerk/clerk-react";
import { Link, useLocation } from "react-router-dom";
import {
  HardDriveIcon,
  NewspaperIcon,
  BoxIcon,
  TerminalIcon,
  SearchIcon,
  BookOpenIcon,
  Gamepad2Icon,
  SettingsIcon,
  ShieldIcon,
  LogOutIcon,
  UserPlusIcon,
  UsersRoundIcon,
  XIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { instanceGradient } from "@/polymet/data/instance-colors";
import { useSidebar } from "@/polymet/hooks/use-sidebar";
import { useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import { inviteOrganizationMember } from "@/polymet/lib/control-plane-api";
import { ProBadge } from "@/polymet/components/pro-badge";
import { isPlatformAdminEmail } from "@/polymet/lib/platform-admin";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavInternalItem = {
  type: "internal";
  to: string;
  label: string;
  icon: typeof NewspaperIcon;
};

type NavExternalItem = {
  type: "external";
  externalKey: "playground" | "docs";
  label: string;
  icon: typeof NewspaperIcon;
};

type NavItem = NavInternalItem | NavExternalItem;

const NAV: NavItem[] = [
  { type: "internal", to: "/", label: "Home", icon: NewspaperIcon },
  { type: "internal", to: "/connection", label: "Connection", icon: TerminalIcon },
  { type: "internal", to: "/instances", label: "Instances", icon: BoxIcon },
  { type: "internal", to: "/storage", label: "Storage", icon: HardDriveIcon },
  { type: "internal", to: "/deep-dive", label: "Deep Dive", icon: SearchIcon },
  { type: "external", externalKey: "playground", label: "Playground", icon: Gamepad2Icon },
  { type: "external", externalKey: "docs", label: "Docs", icon: BookOpenIcon },
];

type TeamModalTab = "invite" | "members";

const ROLE_OPTIONS = [
  { value: "org:admin", label: "Admin" },
  { value: "org:member", label: "Operator" },
  { value: "org:viewer", label: "Viewer" },
] as const;

type InviteRole = (typeof ROLE_OPTIONS)[number]["value"];

export function AppSidebar() {
  const { pathname } = useLocation();
  const { collapsed } = useSidebar();
  const { user } = useUser();
  const { organization } = useOrganization();
  const { signOut } = useClerk();
  const { instances, provisioningActive, workerLinks, plan } = useWorkspaceState();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [teamModalTab, setTeamModalTab] = useState<TeamModalTab | null>(null);

  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname.startsWith(to);

  const onInstances = pathname.startsWith("/instances");

  const displayName = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Wasup user";
  const email = user?.primaryEmailAddress?.emailAddress || "";
  const isPlatformAdmin = isPlatformAdminEmail(email);
  const avatar = user?.imageUrl;
  const openTeamModal = (tab: TeamModalTab) => {
    setUserMenuOpen(false);
    setTeamModalTab(tab);
  };

  return (
    <aside
      className={cn(
        "hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-border/60 bg-background transition-[width,padding,opacity,transform] duration-300 ease-out md:flex",
        collapsed
          ? "w-16 translate-x-0 px-3 py-6 opacity-100"
          : "w-60 translate-x-0 px-4 py-6 opacity-100"
      )}
    >
      <div className={cn("pb-8", collapsed ? "px-0 text-center" : "px-2")}>
        <Link to="/" className="inline-flex items-center gap-2 font-mono text-sm tracking-tight text-foreground" aria-label="Wasup home">
          <span>{collapsed ? "<>" : "<wasup.co/>"}</span>
          {!collapsed && plan?.tier === "pro" && <ProBadge />}
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const Icon = item.icon;
          const navKey = item.type === "internal" ? item.to : item.externalKey;

          if (item.type === "external") {
            const href = item.externalKey === "playground" ? workerLinks.playgroundUrl : workerLinks.docsUrl;
            const disabled = provisioningActive || !href;

            return (
              <div key={navKey}>
                <a
                  href={disabled ? undefined : href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={collapsed ? item.label : undefined}
                  aria-disabled={disabled}
                  onClick={(event) => {
                    if (disabled) event.preventDefault();
                  }}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                    collapsed && "justify-center gap-0 px-0",
                    "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:translate-x-0.5",
                    disabled && "pointer-events-none opacity-45",
                  )}
                >
                  <Icon
                    className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110"
                    fill="none"
                    strokeWidth={2}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    </>
                  )}
                </a>
              </div>
            );
          }

          const active = isActive(item.to);
          const locked = provisioningActive && item.to !== "/connection";

          return (
            <div key={navKey}>
              <Link
                to={item.to}
                onClick={(event) => {
                  if (locked) event.preventDefault();
                }}
                aria-label={collapsed ? item.label : undefined}
                aria-disabled={locked}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                  collapsed && "justify-center gap-0 px-0",
                  active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:translate-x-0.5",
                  locked && "pointer-events-none opacity-45",
                )}
              >
                <Icon
                  className="h-4 w-4 transition-transform duration-200 group-hover:scale-110"
                  fill="none"
                  strokeWidth={2}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>

              {item.to === "/instances" && onInstances && !collapsed && (
                <div className="mt-1 ml-3 space-y-0.5 overflow-hidden border-l border-border/60 pl-3 animate-fade-up">
                  {instances.map((inst) => {
                    const instActive = pathname === `/instances/${inst.id}`;
                    return (
                      <Link
                        key={inst.id}
                        to={`/instances/${inst.id}`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          instActive
                            ? "bg-muted text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        )}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: instanceGradient(inst.id) }}
                        />
                        <span className="truncate">{inst.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {isPlatformAdmin && (
          <Link
            to="/admin"
            onClick={(event) => {
              if (provisioningActive) event.preventDefault();
            }}
            aria-label={collapsed ? "Platform Admin" : undefined}
            aria-disabled={provisioningActive}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
              collapsed && "justify-center gap-0 px-0",
              isActive("/admin")
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:translate-x-0.5",
              provisioningActive && "pointer-events-none opacity-45",
            )}
          >
            <ShieldIcon
              className="h-4 w-4 transition-transform duration-200 group-hover:scale-110"
              fill="none"
              strokeWidth={2}
            />
            {!collapsed && <span>Platform Admin</span>}
          </Link>
        )}

        <Link
          to="/settings"
          onClick={(event) => {
            if (provisioningActive) event.preventDefault();
          }}
          aria-label={collapsed ? "Settings" : undefined}
          aria-disabled={provisioningActive}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
            collapsed && "justify-center gap-0 px-0",
            isActive("/settings")
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:translate-x-0.5",
            provisioningActive && "pointer-events-none opacity-45"
          )}
        >
          <SettingsIcon
            className="h-4 w-4 transition-transform duration-200 group-hover:scale-110"
            fill="none"
            strokeWidth={2}
          />
          {!collapsed && <span>Settings</span>}
        </Link>
      </nav>

      <div className={cn("relative border-t border-border/60 pt-4", collapsed ? "flex justify-center" : "")}>
        <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl text-left transition-colors hover:bg-muted/70",
                collapsed ? "justify-center p-1" : "w-full px-2 py-2",
              )}
              aria-label="Open user and organisation menu"
            >
              <UserAvatar avatar={avatar} displayName={displayName} />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {organization?.name || email || "Signed in"}
                  </div>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={12}
            collisionPadding={12}
            className="z-[100] w-72 rounded-2xl border-border/60 p-0 shadow-2xl ring-1 ring-black/5"
            style={{ zIndex: 100 }}
          >
            <div className="border-b border-border/60 p-4">
              <div className="flex items-center gap-3">
                <UserAvatar avatar={avatar} displayName={displayName} size="lg" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{email || "Signed in"}</div>
                  {organization?.name && (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {organization.name}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="p-2">
              <DropdownMenuItem
                onSelect={() => openTeamModal("invite")}
                disabled={!organization}
                className="flex cursor-pointer gap-3 rounded-xl px-3 py-2.5"
              >
                <UserPlusIcon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">Invite team member</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => openTeamModal("members")}
                disabled={!organization}
                className="flex cursor-pointer gap-3 rounded-xl px-3 py-2.5"
              >
                <UsersRoundIcon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">Manage organisation</span>
              </DropdownMenuItem>
              {!organization && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Select or create a Clerk organisation to invite members.
                </p>
              )}
            </div>
            <DropdownMenuSeparator className="m-0" />
            <div className="p-2">
              <DropdownMenuItem
                onSelect={() => void signOut()}
                className="flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 text-muted-foreground focus:text-foreground"
              >
                <LogOutIcon className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {teamModalTab && (
          <OrganisationTeamModal
            initialTab={teamModalTab}
            organizationName={organization?.name || "Organisation"}
            onClose={() => setTeamModalTab(null)}
          />
        )}
      </div>
    </aside>
  );
}

function UserAvatar({
  avatar,
  displayName,
  size = "sm",
}: {
  avatar?: string;
  displayName: string;
  size?: "sm" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-10 w-10" : "h-8 w-8";
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={displayName}
        className={cn(sizeClass, "shrink-0 rounded-full object-cover")}
      />
    );
  }

  return (
    <div className={cn(sizeClass, "grid shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold")}>
      {displayName.slice(0, 1).toUpperCase()}
    </div>
  );
}

function OrganisationTeamModal({
  initialTab,
  organizationName,
  onClose,
}: {
  initialTab: TeamModalTab;
  organizationName: string;
  onClose: () => void;
}) {
  const { organization, memberships, invitations } = useOrganization({
    memberships: { pageSize: 50 },
    invitations: { pageSize: 50 },
  });
  const [activeTab, setActiveTab] = useState<TeamModalTab>(initialTab);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("org:member");
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);

  const memberRows = memberships?.data ?? [];
  const invitationRows = invitations?.data ?? [];
  const loadingMembers = memberships?.isLoading;
  const loadingInvitations = invitations?.isLoading;

  const submitInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organization || inviting) return;

    const emailAddress = email.trim();
    if (!emailAddress) {
      setInviteError("Enter an email address to invite.");
      return;
    }

    setInviteError("");
    setInviting(true);
    try {
      await inviteOrganizationMember({ emailAddress, role });
      setEmail("");
      await invitations?.revalidate?.();
      toast.success("Invitation sent", {
        description: `${emailAddress} will accept inside the Wasup dashboard.`,
      });
      setActiveTab("members");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send the invitation.";
      setInviteError(message);
      toast.error("Invitation failed", { description: message });
    } finally {
      setInviting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl animate-pop-in sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-4 sm:px-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
              Team
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">{organizationName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Invite members, manage roles, and update organisation settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close organisation profile"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-5">
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-background/80 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("invite")}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                activeTab === "invite"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Invite
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("members")}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                activeTab === "members"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Members
            </button>
          </div>

          {activeTab === "invite" ? (
            <form
              onSubmit={submitInvite}
              className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm sm:p-5"
            >
              <label className="block text-sm font-medium" htmlFor="team-email">
                Email address
              </label>
              <input
                id="team-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
                className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring/30"
              />

              <label className="mt-4 block text-sm font-medium" htmlFor="team-role">
                Role
              </label>
              <select
                id="team-role"
                value={role}
                onChange={(event) => setRole(event.target.value as InviteRole)}
                className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/30"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {inviteError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
                  {inviteError}
                </div>
              )}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-border/60 px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting || !organization}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inviting ? "Sending..." : "Send invite"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Current members</h3>
                    <p className="text-sm text-muted-foreground">
                      People with access to this organisation.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("invite")}
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border/60 px-3 text-sm font-medium hover:bg-muted"
                  >
                    Invite
                  </button>
                </div>

                {loadingMembers ? (
                  <p className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                    Loading members...
                  </p>
                ) : memberRows.length > 0 ? (
                  <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                    {memberRows.map((membership) => (
                      <MemberRow key={membership.id} membership={membership} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                    No members were returned for this organisation.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-border/60 bg-background p-4 shadow-sm sm:p-5">
                <h3 className="font-semibold">Pending invitations</h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  Invites that have not been accepted yet.
                </p>

                {loadingInvitations ? (
                  <p className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                    Loading invitations...
                  </p>
                ) : invitationRows.length > 0 ? (
                  <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                    {invitationRows.map((invitation) => (
                      <InvitationRow key={invitation.id} invitation={invitation} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
                    No pending invitations.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MemberRow({ membership }: { membership: any }) {
  const user = membership.publicUserData;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const identifier = user?.identifier || user?.emailAddress || "Member";
  const displayName = name || identifier;

  return (
    <div className="flex items-center gap-3 bg-background px-3 py-3">
      {user?.imageUrl ? (
        <img src={user.imageUrl} alt={displayName} className="h-9 w-9 rounded-full object-cover" />
      ) : (
        <div className="grid h-9 w-9 place-items-center rounded-full bg-muted text-xs font-semibold">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-muted-foreground">{identifier}</p>
      </div>
      <RoleBadge role={membership.role} />
    </div>
  );
}

function InvitationRow({ invitation }: { invitation: any }) {
  const email = invitation.emailAddress || "Pending invite";

  return (
    <div className="flex items-center gap-3 bg-background px-3 py-3">
      <div className="grid h-9 w-9 place-items-center rounded-full bg-muted text-xs font-semibold">
        {email.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{email}</p>
        <p className="truncate text-xs text-muted-foreground">Invitation pending</p>
      </div>
      <RoleBadge role={invitation.role} />
    </div>
  );
}

function RoleBadge({ role }: { role?: string }) {
  const label = role?.replace(/^org:/, "") || "member";

  return (
    <span className="shrink-0 rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">
      {label}
    </span>
  );
}
