"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type CountKey = 'needsReview' | 'attentionNeeded' | 'cancelled' | 'orders' | 'history' | 'callPending';

type NavItem = { href: string; label: string; countKey?: CountKey };

type NavGroup = { heading: string; items: NavItem[] };

// Workflow / Needs Attention / Reports mirror the three-group IA from the redesign brief.
// "Add order" isn't here -- it lives as the primary action in the Orders page header instead.
const navGroups: NavGroup[] = [
  {
    heading: 'Workflow',
    items: [
      { href: '/orders', label: 'Orders', countKey: 'orders' },
      { href: '/orders?view=call-pending', label: 'Call Pending', countKey: 'callPending' },
      { href: '/history', label: 'History', countKey: 'history' },
      { href: '/orders?view=cancelled', label: 'Cancelled', countKey: 'cancelled' },
    ],
  },
  {
    heading: 'Needs Attention',
    items: [
      { href: '/reports/attention-needed', label: 'Attention Needed', countKey: 'attentionNeeded' },
      { href: '/orders?view=needs-review', label: 'Needs Review', countKey: 'needsReview' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { href: '/reports/products-by-date', label: 'Products by Date' },
      { href: '/reports/feedback', label: 'Feedback Report' },
    ],
  },
];

type SidebarProps = {
  role: 'admin' | 'moderator' | null;
};

export default function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<CountKey, number> | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!role) return;
    let cancelled = false;
    fetch('/api/sidebar/counts')
      .then((res) => res.json())
      .then((result) => {
        if (!cancelled && result?.ok) {
          setCounts({
            needsReview: result.needsReview,
            attentionNeeded: result.attentionNeeded,
            cancelled: result.cancelled,
            orders: result.orders,
            history: result.history,
            callPending: result.callPending,
          });
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

  const isActive = (href: string) => {
    const [itemPath, itemQuery] = href.split('?');
    if (itemPath === '/orders' && !itemQuery) {
      return (pathname === '/orders' && !searchParams.get('view')) || (pathname?.startsWith('/orders/') && !pathname?.startsWith('/orders/new'));
    }
    if (itemQuery) {
      return pathname === itemPath && searchParams.toString() === itemQuery;
    }
    return pathname?.startsWith(href);
  };

  return (
    <aside className="app-sidebar">
      <Link href="/orders" className="sidebar-logo-link">
        <span className="sidebar-logo-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Nitto" />
        </span>
      </Link>

      <nav className="sidebar-nav">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((item) => item.href !== '/reports/products-by-date' || role === 'admin');
          if (visibleItems.length === 0) return null;
          return (
            <div className="sidebar-group" key={group.heading}>
              <div className="sidebar-group-heading">{group.heading}</div>
              {visibleItems.map((item) => {
                const count = item.countKey ? counts?.[item.countKey] : undefined;
                return (
                  <Link key={item.href} href={item.href} className={`sidebar-link${isActive(item.href) ? ' active' : ''}`}>
                    <span>{item.label}</span>
                    {typeof count === 'number' ? <span className="sidebar-count">{count}</span> : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {role === 'admin' ? (
          <Link href="/settings" className={`sidebar-link${pathname?.startsWith('/settings') ? ' active' : ''}`} style={{ margin: 0 }}>
            <span>Settings</span>
          </Link>
        ) : null}
        {role ? (
          <button type="button" onClick={handleSignOut} disabled={signingOut} className="sidebar-signout">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
