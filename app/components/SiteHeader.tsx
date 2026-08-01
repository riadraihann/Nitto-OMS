"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type NavItem = { href: string; label: string; adminOnly?: boolean; countKey?: 'needsReview' | 'attentionNeeded' };

// adminOnly entries are also enforced by middleware.ts's ADMIN_ONLY_ROUTE_PREFIXES -- declared
// once here, both the nav filter below and that route guard should stay in sync when a future
// admin-only page is added.
const navItems: NavItem[] = [
  { href: '/orders', label: 'Orders' },
  { href: '/history', label: 'History' },
  { href: '/orders/new', label: 'Add order' },
  { href: '/orders?view=needs-review', label: 'Needs Review', countKey: 'needsReview' },
  { href: '/reports/products-by-date', label: 'Products report', adminOnly: true },
  { href: '/reports/attention-needed', label: 'Attention Needed', countKey: 'attentionNeeded' },
  { href: '/reports/feedback', label: 'Feedback report' },
  { href: '/reports/ignored-flags', label: 'Ignored Flags' },
];

type SiteHeaderProps = {
  role: 'admin' | 'moderator' | null;
};

export default function SiteHeader({ role }: SiteHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [counts, setCounts] = useState<{ needsReview: number; attentionNeeded: number } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!role) return;
    let cancelled = false;
    fetch('/api/flags/counts')
      .then((res) => res.json())
      .then((result) => {
        if (!cancelled && result?.ok) {
          setCounts({ needsReview: result.needsReview, attentionNeeded: result.attentionNeeded });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // refetch whenever the route changes, so counts stay reasonably fresh as the user navigates
    // and actions flags -- this is a client component with no server-pushed data source.
  }, [role, pathname, searchParams]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await fetch('/api/auth/signout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const visibleItems = navItems.filter((item) => !item.adminOnly || role === 'admin');

  return (
    <header style={{ background: '#ffffff' }}>
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '0.6rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <Link href="/orders" style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Nitto" style={{ height: '44px', width: 'auto' }} />
        </Link>

        <nav style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {visibleItems.map((item) => {
            const [itemPath, itemQuery] = item.href.split('?');
            const active =
              itemPath === '/orders' && !itemQuery
                ? (pathname === '/orders' && !searchParams.get('view')) || (pathname?.startsWith('/orders/') && !pathname?.startsWith('/orders/new'))
                : itemQuery
                  ? pathname === itemPath && searchParams.toString() === itemQuery
                  : pathname?.startsWith(item.href);
            const count = item.countKey ? counts?.[item.countKey] : undefined;
            return (
              <Link key={item.href} href={item.href} className={`nav-pill${active ? ' active' : ''}`}>
                {item.label}
                {typeof count === 'number' ? ` (${count})` : ''}
              </Link>
            );
          })}
          {role ? (
            <button type="button" onClick={handleSignOut} disabled={signingOut} className="nav-pill" style={{ cursor: 'pointer' }}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          ) : null}
        </nav>
      </div>
      {/* the one deliberately distinctive touch -- everything else stays quiet around it */}
      <div style={{ height: '3px', background: 'linear-gradient(90deg, var(--gradient-blue), var(--gradient-green), var(--gradient-gold))' }} />
    </header>
  );
}
