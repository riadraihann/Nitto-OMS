import './globals.css';
import type { Metadata } from 'next';
import SiteHeader from './components/SiteHeader';

export const metadata: Metadata = {
  title: 'Nitto OMS',
  description: 'Supabase-backed order management tool',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
