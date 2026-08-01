import Link from 'next/link';
import type { CSSProperties } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import { computeAttentionNeededWithFlags } from '@/lib/attentionNeededWithFlags';
import { statusLabel, telHref } from '@/lib/theme';
import AttentionFlagActions from './AttentionFlagActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ReportPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function OrderLink({ id, order_number, customer_name }: { id: number; order_number: string | null; customer_name: string }) {
  return (
    <Link href={`/orders/${id}`} style={{ fontWeight: 600, color: '#a83aa3' }}>
      {order_number ?? `Order #${id}`} · {customer_name}
    </Link>
  );
}

export default async function AttentionNeededPage({ searchParams }: ReportPageProps) {
  if (!supabaseAdmin) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Attention Needed</h1>
        <p>Supabase is not configured yet.</p>
      </main>
    );
  }

  const staleDaysParam = getParam(searchParams?.stale_days);
  const staleDays = Number.isFinite(Number(staleDaysParam)) && Number(staleDaysParam) > 0 ? Number(staleDaysParam) : 3;

  let checks;
  let errorMessage = '';
  try {
    checks = await computeAttentionNeededWithFlags(staleDays);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
  }

  if (errorMessage || !checks) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Attention Needed</h1>
        <p>Unable to load: {errorMessage}</p>
      </main>
    );
  }

  const totalCount = checks.subtotalMismatches.length + checks.staleStatus.length + checks.urgencyPassed.length + checks.duplicateGroups.length;

  const sectionStyle: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' };
  const rowStyle: CSSProperties = { padding: '0.5rem 0', borderBottom: '1px solid #f0f0f0', fontSize: '0.9rem' };

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Attention Needed</h1>
          <p style={{ margin: 0, color: '#666' }}>Daily data-integrity checks -- flagged, not auto-fixed. Recomputed live on every visit.</p>
        </div>
        <Link href="/orders" className="nav-pill">← Back to orders</Link>
      </div>

      <div style={{ borderLeft: '4px solid #0a2472', background: '#eaeef7', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem', fontWeight: 700, color: '#0a2472' }}>
        {totalCount === 0 ? 'Nothing flagged -- all clear.' : `${totalCount} item${totalCount === 1 ? '' : 's'} flagged across ${[
          checks.subtotalMismatches.length && 'subtotal mismatches',
          checks.staleStatus.length && 'stale statuses',
          checks.urgencyPassed.length && 'overdue urgency',
          checks.duplicateGroups.length && 'possible duplicates',
        ].filter(Boolean).length} categories`}
      </div>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Bill amount doesn&apos;t match items ({checks.subtotalMismatches.length})</h2>
        <p style={{ color: '#666', fontSize: '0.85rem', marginTop: '-0.5rem' }}>Only compared when items carry real per-item pricing -- sheet-sourced orders without it are excluded, not flagged.</p>
        {checks.subtotalMismatches.length === 0 ? <p style={{ color: '#666' }}>None.</p> : (
          <div>
            {checks.subtotalMismatches.map((o) => (
              <div key={o.id} style={{ ...rowStyle, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <OrderLink {...o} />
                <span style={{ color: '#8a5300' }}>Stored: ৳{o.total_amount.toFixed(2)} · Items sum to: ৳{o.computed_subtotal.toFixed(2)}</span>
                <AttentionFlagActions orderId={o.id} flagType="subtotal_mismatch" />
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>No status change in {staleDays}+ days ({checks.staleStatus.length})</h2>
          <form action="/reports/attention-needed" method="get" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
            <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              Days
              <input type="number" min="1" name="stale_days" defaultValue={staleDays} style={{ width: '4rem' }} />
            </label>
            <button type="submit">Apply</button>
          </form>
        </div>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>Only active orders (not yet confirmed+delivered, not cancelled/returned).</p>
        {checks.staleStatus.length === 0 ? <p style={{ color: '#666' }}>None.</p> : (
          <div>
            {checks.staleStatus.map((o) => (
              <div key={o.id} style={{ ...rowStyle, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <OrderLink {...o} />
                <span style={{ color: '#8a5300' }}>
                  {statusLabel(o.confirmation_status)} / {statusLabel(o.delivery_status)} · {o.days_since} days since last change
                </span>
                <AttentionFlagActions orderId={o.id} flagType="stale_status" />
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>VU/D date passed but still unresolved ({checks.urgencyPassed.length})</h2>
        {checks.urgencyPassed.length === 0 ? <p style={{ color: '#666' }}>None.</p> : (
          <div>
            {checks.urgencyPassed.map((o) => (
              <div key={o.id} style={{ ...rowStyle, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <OrderLink {...o} />
                <span style={{ color: '#c62828' }}>
                  {o.urgency_type.toUpperCase()} target {o.urgency_target_date}, {o.days_overdue}d overdue · {statusLabel(o.confirmation_status)} / {statusLabel(o.delivery_status)}
                </span>
                <AttentionFlagActions orderId={o.id} flagType="urgency_passed" />
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Possible duplicates ({checks.duplicateGroups.length})</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>Same phone, same calendar day, at least one shared product -- last 30 days only.</p>
        {checks.duplicateGroups.length === 0 ? <p style={{ color: '#666' }}>None.</p> : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {checks.duplicateGroups.map((group) => (
              <div key={`${group.phone}__${group.day}`} style={{ border: '1px solid #f0e0c0', background: '#fff8e1', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                <div style={{ fontSize: '0.85rem', color: '#8a5300', marginBottom: '0.35rem' }}>
                  <a href={telHref(group.phone)}>{group.phone}</a> · {group.day}
                </div>
                {group.orders.map((o) => (
                  <div key={o.id} style={{ ...rowStyle, borderBottom: 'none', padding: '0.25rem 0', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span><OrderLink {...o} /> <span style={{ color: '#666' }}>— {o.items.join(', ') || 'no items'}</span></span>
                    <AttentionFlagActions orderId={o.id} flagType="duplicate_group" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
