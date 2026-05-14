import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  WASUP_API_KEY_PEPPER: z.string().min(16).optional()
});

export function getServerEnv() {
  return EnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    WASUP_API_KEY_PEPPER: process.env.WASUP_API_KEY_PEPPER
  });
}
