import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export async function GET() {
  const checks: Record<string, 'ok' | 'missing' | 'error'> = {
    clerk: process.env.CLERK_SECRET_KEY ? 'ok' : 'missing',
    supabase: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'ok' : 'missing'
  };

  if (checks.supabase === 'ok') {
    const { error } = await getSupabaseAdmin()
      .from('organizations')
      .select('id', { count: 'exact', head: true });
    if (error) checks.supabase = 'error';
  }

  const healthy = Object.values(checks).every((value) => value === 'ok');

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      service: 'wasup-control-plane',
      checks
    },
    { status: healthy ? 200 : 503 }
  );
}
