import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from './env';

let adminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  const env = getServerEnv();
  adminClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  return adminClient;
}
