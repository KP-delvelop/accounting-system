import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const isSupabaseMode = import.meta.env.VITE_DATA_MODE === 'supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let browserClient: SupabaseClient | null = null;

export function supabaseConfigStatus() {
  return {
    configured: Boolean(supabaseUrl && supabasePublishableKey),
    url: supabaseUrl ?? '',
  };
}

export function getSupabaseClient() {
  if (!isSupabaseMode) return null;
  if (!supabaseUrl || !supabasePublishableKey) return null;
  browserClient ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
