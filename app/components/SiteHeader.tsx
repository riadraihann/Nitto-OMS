"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/orders', label: 'Orders' },
  { href: '/orders/new', label: 'Add order' },
  { href: '/reports/products-by-date', label: 'Products report' },
  { href: '/reports/attention-needed', label: 'Attention Needed' },
];

export default function SiteHeader() {
  const pathname = usePathname();

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
          {navItems.map((item) => {
            const active =
              item.href === '/orders'
                ? pathname === '/orders' || (pathname?.startsWith('/orders/') && !pathname?.startsWith('/orders/new'))
                : pathname?.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`nav-pill${active ? ' active' : ''}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {/* the one deliberately distinctive touch -- everything else stays quiet around it */}
      <div style={{ height: '3px', background: 'linear-gradient(90deg, var(--gradient-blue), var(--gradient-green), var(--gradient-gold))' }} />
    </header>
  );
}
