import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const env = process.env as unknown as Record<string, string | undefined>;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

// extend this as future admin-only pages are added -- SiteHeader's nav filter and this array
// both key off the same route prefixes, declared once (see app/components/SiteHeader.tsx).
const ADMIN_ONLY_ROUTE_PREFIXES = ['/reports/products-by-date'];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAdminRoute = ADMIN_ONLY_ROUTE_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
  if (isAdminRoute) {
    const role = user.user_metadata?.role === 'admin' ? 'admin' : 'moderator';
    if (role !== 'admin') {
      return NextResponse.redirect(new URL('/orders', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!login|_next/static|_next/image|favicon.ico|logo.png).*)'],
};
