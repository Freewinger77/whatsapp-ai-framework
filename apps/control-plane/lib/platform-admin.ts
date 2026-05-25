import { auth, currentUser } from '@clerk/nextjs/server';

const DEFAULT_PLATFORM_ADMIN_EMAILS = ['arslan@tryrapidscreen.com'];

export async function requirePlatformAdmin() {
  const email = await getAuthenticatedClerkEmail();
  if (!email) return { allowed: false, email: null };

  return {
    allowed: getPlatformAdminEmailSet().has(normalizeEmail(email)),
    email
  };
}

function getPlatformAdminEmailSet() {
  const configured = parseEmailList(process.env.WASUP_PLATFORM_ADMIN_EMAILS);
  return new Set([...configured, ...DEFAULT_PLATFORM_ADMIN_EMAILS].map(normalizeEmail));
}

function parseEmailList(value: string | undefined) {
  return (value || '')
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function getAuthenticatedClerkEmail() {
  const session = await auth();
  if (!session.userId) return null;

  const claims = session.sessionClaims as Record<string, unknown> | null | undefined;
  const claimEmail =
    stringClaim(claims?.email) ||
    stringClaim(claims?.primary_email_address) ||
    stringClaim(claims?.primaryEmailAddress);

  if (claimEmail) return claimEmail;

  const user = await currentUser();
  return user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || null;
}

function stringClaim(value: unknown) {
  return typeof value === 'string' ? value : '';
}
