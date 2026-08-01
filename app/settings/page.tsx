import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireAdmin();

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Admin-only tools -- rarely-needed recovery and audit views, kept out of the daily workflow nav.</p>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Link href="/settings/archived" style={{ fontWeight: 700, fontSize: '1.05rem' }}>
          Archived orders
        </Link>
        <p style={{ margin: 0, color: '#666' }}>Orders hidden from every normal view. Restore one back into the active queue at any time.</p>
      </div>

      <div className="card" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Link href="/reports/ignored-flags" style={{ fontWeight: 700, fontSize: '1.05rem' }}>
          Ignored flags
        </Link>
        <p style={{ margin: 0, color: '#666' }}>Audit trail of Attention Needed / Needs Review flags dismissed as false positives.</p>
      </div>
    </div>
  );
}
