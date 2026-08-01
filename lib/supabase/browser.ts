import { createBrowserClient } from '@supabase/ssr';

// This file is bundled into the browser (imported by the "use client" login page), so env vars
// must be read as direct static `process.env.X` member expressions -- that's the only form
// webpack's build-time inlining recognizes for NEXT_PUBLIC_ vars. Going through an intermediate
// object (`const env = process.env; env.X`), as lib/supabase.ts does, is safe there because that
// file is server-only, but breaks here: the whole `process` global doesn't exist in the browser,
// so a dynamic property read on it throws "process is not defined" at runtime.
// the `as Record<...>` cast is erased at compile time (TS type assertions have no runtime
// footprint), so this still emits a literal `process.env.NEXT_PUBLIC_X` member expression for
// webpack to statically inline -- unlike assigning `process.env` to a variable first, which
// would turn it into a real runtime property read on a variable instead.
const supabaseUrl = (process.env as unknown as Record<string, string | undefined>).NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = (process.env as unknown as Record<string, string | undefined>).NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

// Used only by the login page -- everywhere else, client components talk to the backend via
// fetch('/api/...') rather than calling Supabase directly.
export function createBrowserSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
