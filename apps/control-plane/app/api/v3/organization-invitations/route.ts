import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';

const InviteMemberSchema = z.object({
  emailAddress: z.string().email().max(320),
  role: z.enum(['org:admin', 'org:member', 'org:viewer'])
});

const DEFAULT_DASHBOARD_URL = 'https://dev.wasup.co';

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  if (principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Only organization owners and admins can invite members.' },
      { status: 403 }
    );
  }

  const session = await auth();
  if (!session.userId || !session.orgId) {
    return NextResponse.json(
      { error: 'Missing Clerk organization', message: 'Select a Clerk organization before inviting members.' },
      { status: 400 }
    );
  }

  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.json(
      { error: 'Clerk is not configured', message: 'Organization invitations require CLERK_SECRET_KEY.' },
      { status: 503 }
    );
  }

  const parsed = InviteMemberSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const clerk = await clerkClient();
    const redirectUrl = buildInvitationRedirectUrl(session.orgId);
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: session.orgId,
      inviterUserId: session.userId,
      emailAddress: parsed.data.emailAddress,
      role: parsed.data.role,
      redirectUrl,
      publicMetadata: {
        wasupOrgId: principal.orgId,
        wasupClerkOrgId: session.orgId,
        wasupDashboardUrl: getDashboardUrl()
      }
    });

    return NextResponse.json({
      success: true,
      redirectUrl,
      invitation: {
        id: invitation.id,
        emailAddress: invitation.emailAddress,
        role: invitation.role,
        status: invitation.status
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Invitation failed', message: getClerkErrorMessage(error) },
      { status: getClerkErrorStatus(error) }
    );
  }
}

function buildInvitationRedirectUrl(clerkOrgId: string) {
  const url = new URL(getDashboardUrl());
  url.searchParams.set('wasup_flow', 'accept-invitation');
  url.searchParams.set('wasup_org', clerkOrgId);
  url.hash = '/accept-invitation';
  return url.toString();
}

function getDashboardUrl() {
  const configured = process.env.WASUP_DASHBOARD_URL?.trim() || DEFAULT_DASHBOARD_URL;
  const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;

  try {
    const url = new URL(withProtocol);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

function getClerkErrorStatus(error: unknown) {
  if (typeof error === 'object' && error && 'status' in error) {
    const status = Number(error.status);
    if (Number.isInteger(status) && status >= 400 && status < 600) return status;
  }
  return 500;
}

function getClerkErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error && 'errors' in error && Array.isArray(error.errors)) {
    const first = error.errors[0] as { message?: string } | undefined;
    if (first?.message) return first.message;
  }
  return 'Could not create the organization invitation.';
}
