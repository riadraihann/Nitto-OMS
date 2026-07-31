import { createClient } from '@supabase/supabase-js';

const env = process.env as unknown as Record<string, string | undefined>;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

function createSafeClient(url: string, key: string) {
  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const supabase = createSafeClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createSafeClient(supabaseUrl, supabaseServiceRoleKey);
