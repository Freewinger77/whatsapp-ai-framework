import { NextResponse } from 'next/server';
import { authorizePublicPairingRequest, PAIRING_NO_STORE_HEADERS } from '../../../../../../lib/pairing-public';
import { mapWorkerInstanceStatus } from '../../../../../../lib/worker-instance-state';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizePublicPairingRequest(req, id);
  if ('error' in auth && auth.error) return auth.error;

  const status = mapWorkerInstanceStatus(auth.instance.status);
  return NextResponse.json(
    {
      success: true,
      instance: {
        id: auth.instance.id,
        name: auth.instance.name,
        status,
        phone: auth.instance.phone || null
      }
    },
    { headers: PAIRING_NO_STORE_HEADERS }
  );
}
