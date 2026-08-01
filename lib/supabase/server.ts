import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

const env = process.env as unknown as Record<string, string | undefined>;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

export type Actor = {
  email: string;
  name: string;
  role: 'admin' | 'moderator';
};

// Cookie-aware client for Server Components and Route Handlers -- reads/writes the session cookie
// set at login, unlike lib/supabase.ts's clients which never persist a session.
export function createServerSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a Server Component render, where cookies() is read-only -- middleware
          // is what actually refreshes the session cookie on navigations, so this is safe to ignore.
        }
      },
    },
  });
}

// role defaults to 'moderator' (least privilege) if user_metadata.role is missing or unrecognized,
// so a misconfigured account never accidentally gets admin access.
export async function getActor(): Promise<Actor | null> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) return null;

  const metadata = user.user_metadata as Record<string, unknown> | null;
  const role = metadata?.role === 'admin' ? 'admin' : 'moderator';
  const name = typeof metadata?.display_name === 'string' && metadata.display_name.trim() ? metadata.display_name.trim() : user.email;

  return { email: user.email, name, role };
}
