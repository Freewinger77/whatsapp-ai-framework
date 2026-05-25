import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import {
  blockOrganization,
  deleteOrganizationAsPlatformAdmin,
  deleteOrganizationVm,
  unblockOrganization
} from '../../../../../../lib/platform-admin-ops';
import { requirePlatformAdmin } from '../../../../../../lib/platform-admin';

const ActionSchema = z.object({
  action: z.enum(['block', 'unblock']),
  reason: z.string().max(500).optional()
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const parsed = ActionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;

  try {
    const result =
      parsed.data.action === 'block'
        ? await blockOrganization(id, principal.actorId, parsed.data.reason)
        : await unblockOrganization(id, principal.actorId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Organization action failed' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope');

  try {
    if (scope === 'vm') {
      const result = await deleteOrganizationVm(id, principal.actorId);
      return NextResponse.json(result, { status: 202 });
    }

    const result = await deleteOrganizationAsPlatformAdmin(id, principal.actorId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 500 }
    );
  }
}
