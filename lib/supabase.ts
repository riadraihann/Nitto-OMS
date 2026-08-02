import { createClient } from '@supabase/supabase-js';

const env = process.env as unknown as Record<string, string | undefined>;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

// supabase-js makes its requests through the global fetch() -- inside a Next.js server context
// (Route Handlers, Server Components), that's Next's own patched fetch, which caches responses
// by default unless told not to. A route/page setting `dynamic = 'force-dynamic'` is supposed to
// cover this, but proved not to be enough in practice: /api/sidebar/counts had that set and still
// served a Call Pending count of 42 long after the real count had dropped to 11, apparently from
// a stale cached fetch response rather than a fresh query. Passing an explicit no-store fetch
// here means every request this client makes bypasses Next's cache regardless of which route
// calls it, instead of relying on every call site remembering the right segment config.
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, cache: 'no-store' });
}

function createSafeClient(url: string, key: string) {
  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: noStoreFetch,
    },
  });
}

export const supabase = createSafeClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createSafeClient(supabaseUrl, supabaseServiceRoleKey);
