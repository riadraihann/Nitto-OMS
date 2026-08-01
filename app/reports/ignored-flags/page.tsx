import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { NEEDS_REVIEW_REASON_LABELS } from '@/lib/orderValidation.mjs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ATTENTION_NEEDED_LABELS: Record<string, string> = {
  subtotal_mismatch: "Bill amount doesn't match items",
  stale_status: 'No status change in X+ days',
  urgency_passed: 'VU/D date passed but still unresolved',
  duplicate_group: 'Possible duplicate',
};

function flagLabel(flagType: string) {
  return NEEDS_REVIEW_REASON_LABELS[flagType] ?? ATTENTION_NEEDED_LABELS[flagType] ?? flagType;
}

type IgnoredFlagRow = {
  id: number;
  order_id: number;
  flag_type: string;
  source_system: string;
  note: string | null;
  actor_name: string | null;
  actor_email: string;
  acted_at: string;
  orders: { order_number: string | null; customer_name: string } | null;
};

export default async function IgnoredFlagsPage() {
  if (!supabaseAdmin) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Ignored Flags</h1>
        <p>Supabase is not configured yet.</p>
      </main>
    );
  }

  const { data, error } = await supabaseAdmin
    .from('flags')
    .select('id, order_id, flag_type, source_system, note, actor_name, actor_email, acted_at, orders(order_number, customer_name)')
    .eq('status', 'ignored')
    .order('acted_at', { ascending: false });

  const rows = (data ?? []) as unknown as IgnoredFlagRow[];

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Ignored Flags</h1>
          <p style={{ margin: 0, color: '#666' }}>
            False positives dismissed for a specific order + flag type -- permanently suppressed from Attention Needed and Needs Review, but kept here for audit.
          </p>
        </div>
        <Link href="/orders" className="nav-pill">← Back to orders</Link>
      </div>

      {error ? (
        <p>Unable to load: {error.message}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#666' }}>Nothing ignored yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {rows.map((row) => (
            <div key={row.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <Link href={`/orders/${row.order_id}`} style={{ fontWeight: 600, color: '#a83aa3' }}>
                  {row.orders?.order_number ?? `Order #${row.order_id}`} · {row.orders?.customer_name}
                </Link>
                <span style={{ color: '#666', fontSize: '0.85rem' }}>
                  {row.actor_name ?? row.actor_email} · {new Date(row.acted_at).toLocaleString()}
                </span>
              </div>
              <div style={{ marginTop: '0.3rem', fontSize: '0.9rem' }}>
                <strong>{flagLabel(row.flag_type)}</strong>{' '}
                <span style={{ color: '#999', fontSize: '0.8rem' }}>
                  ({row.source_system === 'needs_review' ? 'Needs Review' : 'Attention Needed'})
                </span>
              </div>
              {row.note ? <div style={{ marginTop: '0.3rem', color: '#8a5300' }}>Reason: {row.note}</div> : null}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
