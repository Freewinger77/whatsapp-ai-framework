import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecret, supabaseUrl } from "../config";

let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  const url = supabaseUrl();
  const key = supabaseSecret();
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not set");
  }
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export function supabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseSecret());
}
