import { authorizePublicPairingRequest, publicClearWorkerAuth } from '../../../../../../../lib/pairing-public';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizePublicPairingRequest(req, id);
  return publicClearWorkerAuth(auth);
}
