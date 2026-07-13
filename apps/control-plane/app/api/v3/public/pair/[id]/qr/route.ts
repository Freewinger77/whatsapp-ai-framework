import { authorizePublicPairingRequest, publicGetWorkerQr } from '../../../../../../../lib/pairing-public';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizePublicPairingRequest(req, id);
  return publicGetWorkerQr(auth);
}
