import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sessionStorage } from '@/lib/storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const publishableKey = (
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
)?.trim();

export const supabaseConfigured = Boolean(url && publishableKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        flowType: 'pkce',
        // Auth callbacks are verified explicitly with a one-time token hash in
        // /auth/confirm. Never accept access/refresh tokens from arbitrary URLs.
        detectSessionInUrl: false,
      },
    })
  : null;

export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
}

export const appUrl = process.env.EXPO_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://pagaste.app';
