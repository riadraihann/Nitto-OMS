import { createBrowserClient } from '@supabase/ssr';

const env = process.env as unknown as Record<string, string | undefined>;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

// Used only by the login page -- everywhere else, client components talk to the backend via
// fetch('/api/...') rather than calling Supabase directly.
export function createBrowserSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
