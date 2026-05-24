import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export async function GET() {
  const checks: Record<string, 'ok' | 'missing' | 'error'> = {
    clerk: process.env.CLERK_SECRET_KEY ? 'ok' : 'missing',
    supabase: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'ok' : 'missing',
    stripe: process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_INSTANCE_PRICE_ID ? 'ok' : 'missing',
    godaddy: process.env.GODADDY_API_KEY && process.env.GODADDY_API_SECRET ? 'ok' : 'missing',
    schema: 'missing',
    provisioning: process.env.WASUP_PROVISIONING_MODE === 'webhook' ? (process.env.AZURE_PROVISIONING_WEBHOOK_URL ? 'ok' : 'missing') : 'ok',
    lifecycle: process.env.WASUP_WORKER_SHARED_SECRET ? 'ok' : 'missing',
    scheduler: process.env.WASUP_ENABLE_INTERNAL_SCHEDULER === 'true' ? 'ok' : 'missing',
    email: process.env.SMTP_HOST && process.env.SMTP_FROM ? 'ok' : 'missing'
  };

  if (checks.supabase === 'ok') {
    const { error } = await getSupabaseAdmin()
      .from('organizations')
      .select('id', { count: 'exact', head: true });
    if (error) checks.supabase = 'error';
    if (!error) {
      const schemaChecks = await Promise.all([
        getSupabaseAdmin().from('org_deployments').select('id').limit(1),
        getSupabaseAdmin().from('notification_events').select('id').limit(1)
      ]);
      checks.schema = schemaChecks.every((result) => !result.error) ? 'ok' : 'error';
    }
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
