import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizePublicPairingRequest, publicConnectWorker } from '../../../../../../../lib/pairing-public';

const ConnectSchema = z.object({
  pairingPhone: z.string().min(6).max(32).optional()
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizePublicPairingRequest(req, id);
  const parsed = ConnectSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }
  return publicConnectWorker(auth, parsed.data);
}
