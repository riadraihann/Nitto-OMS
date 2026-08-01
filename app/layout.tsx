import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter, Poppins } from 'next/font/google';
import SiteHeader from './components/SiteHeader';
import { getActor } from '@/lib/supabase/server';

// self-hosted at build time by Next.js (no runtime request to Google, no extra JS bundle) --
// Inter for all UI/table text, with next/font's automatic fallback-metric matching to avoid
// layout shift while it loads. Poppins is reserved for h1 page titles only (see globals.css).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const poppins = Poppins({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display-font', display: 'swap' });

export const metadata: Metadata = {
  title: 'Nitto OMS',
  description: 'Supabase-backed order management tool',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <body>
        <Suspense fallback={null}>
          <SiteHeader role={actor?.role ?? null} />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
