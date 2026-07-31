import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { statusBadgeStyle, statusLabel } from '@/lib/theme';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OrderItem = {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
};

type OrderRow = {
  id: number;
  order_number: string | null;
  customer_name: string;
  urgency_status: string;
  confirmation_status: string;
  delivery_status: string;
  created_at: string;
  total_amount: number | null;
  order_items: OrderItem[];
};

type OrdersPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function buildHref(params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `/orders${search.toString() ? `?${search.toString()}` : ''}`;
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  if (!supabaseAdmin) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Orders</h1>
        <p>Supabase is not configured yet.</p>
      </main>
    );
  }

  const urgency = getParam(searchParams?.urgency_status);
  const confirmation = getParam(searchParams?.confirmation_status);
  const delivery = getParam(searchParams?.delivery_status);
  const view = getParam(searchParams?.view);
  const sort = getParam(searchParams?.sort) || 'date';
  const dateFrom = getParam(searchParams?.date_from);
  const dateTo = getParam(searchParams?.date_to);

  const CALL_PENDING_STAGES = ['pending', 'x1', 'x2', 'x3'];

  let query = supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_name, urgency_status, confirmation_status, delivery_status, created_at, total_amount, order_items(sku, product_name, quantity, unit_price)')
    .order('created_at', { ascending: false });

  if (view === 'ready-for-delivery') {
    query = query.in('delivery_status', ['sent_to_courier', 'delivered']);
  } else if (view === 'call-pending') {
    query = query.eq('order_source', 'shopify').in('confirmation_status', CALL_PENDING_STAGES);
  } else {
    if (urgency) {
      query = query.eq('urgency_status', urgency);
    }
    if (confirmation) {
      query = query.eq('confirmation_status', confirmation);
    }
    if (delivery) {
      query = query.eq('delivery_status', delivery);
    }
  }

  // dates are picked as plain calendar days; interpret them as Asia/Dhaka (UTC+6) local-day
  // boundaries, matching how order timestamps were imported
  if (dateFrom) {
    query = query.gte('created_at', `${dateFrom}T00:00:00+06:00`);
  }
  if (dateTo) {
    query = query.lte('created_at', `${dateTo}T23:59:59.999+06:00`);
  }

  let data: any[] | null = null;
  let errorMessage = '';

  try {
    const result = await query;
    data = result.data as any[] | null;
    if (result.error) {
      const { message, code, details, hint } = result.error;
      errorMessage = [message, code && `code=${code}`, details, hint].filter(Boolean).join(' | ');
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
  }

  if (errorMessage) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Orders</h1>
        <p>Unable to load orders: {errorMessage}</p>
      </main>
    );
  }

  let orders = (data ?? []) as OrderRow[];

  // PostgREST can't order by an arbitrary custom sequence, so the "by confirmation stage"
  // sort (only offered on the Call Pending view) is applied client-side after the
  // already-small filtered result set comes back. Newest-first within each stage.
  if (view === 'call-pending' && sort === 'stage') {
    const stageRank = (status: string) => {
      const idx = CALL_PENDING_STAGES.indexOf(status);
      return idx === -1 ? CALL_PENDING_STAGES.length : idx;
    };
    orders = [...orders].sort((a, b) => stageRank(a.confirmation_status) - stageRank(b.confirmation_status));
  }

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Orders</h1>
          <p style={{ margin: 0, color: '#666' }}>A practical view of order headers plus their line items.</p>
        </div>
        <Link href="/orders/new" style={{ textDecoration: 'none' }}>
          <button type="button">Add order</button>
        </Link>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link href="/orders" className={`nav-pill${!view ? ' active' : ''}`}>
          All
        </Link>
        <Link href={buildHref({ view: 'ready-for-delivery' })} className={`nav-pill${view === 'ready-for-delivery' ? ' active' : ''}`}>
          Ready for delivery
        </Link>
        <Link href={buildHref({ view: 'call-pending' })} className={`nav-pill${view === 'call-pending' ? ' active' : ''}`}>
          Call Pending
        </Link>
        <Link href="/reports/products-by-date" className="nav-pill">
          Products by date report
        </Link>
      </div>

      <form action="/orders" method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="hidden" name="view" value={view} />
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          From
          <input type="date" name="date_from" defaultValue={dateFrom} />
        </label>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          To
          <input type="date" name="date_to" defaultValue={dateTo} />
        </label>
        {view !== 'call-pending' ? (
          <>
            <select name="urgency_status" defaultValue={urgency}>
              <option value="">All urgencies</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
              <option value="hold">Hold</option>
            </select>
            <select name="confirmation_status" defaultValue={confirmation}>
              <option value="">All confirmations</option>
              <option value="pending">Pending</option>
              <option value="x1">X1</option>
              <option value="x2">X2</option>
              <option value="x3">X3</option>
              <option value="confirmed_m">Confirmed (M)</option>
              <option value="confirmed_wa">Confirmed (Wa)</option>
              <option value="confirmed_c">Confirmed (C)</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select name="delivery_status" defaultValue={delivery}>
              <option value="">All deliveries</option>
              <option value="packaging">Packaging</option>
              <option value="sent_to_courier">Sent to courier</option>
              <option value="delivered">Delivered</option>
              <option value="returned">Returned</option>
            </select>
          </>
        ) : null}
        <button type="submit">Apply</button>
        <Link href="/orders" className="nav-pill">
          Clear
        </Link>
      </form>

      {view === 'call-pending' ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', fontSize: '0.9rem' }}>
          <span style={{ color: '#666' }}>Sort by:</span>
          <Link href={buildHref({ view: 'call-pending', sort: 'date' })} className={`nav-pill${sort !== 'stage' ? ' active' : ''}`}>
            Date (newest first)
          </Link>
          <Link href={buildHref({ view: 'call-pending', sort: 'stage' })} className={`nav-pill${sort === 'stage' ? ' active' : ''}`}>
            Confirmation stage
          </Link>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {orders.map((order) => {
          const itemSummary = (order.order_items ?? []).map((item) => `${item.quantity} × ${item.sku || item.product_name}`).join(', ');
          const computedSubtotal = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
          const subtotal = order.total_amount ?? computedSubtotal;
          const rowStyle = order.urgency_status === 'urgent'
            ? { backgroundColor: '#ffe6e6' }
            : order.urgency_status === 'hold'
              ? { backgroundColor: '#fff7d6' }
              : { backgroundColor: '#fff' };

          return (
            <article key={order.id} style={{ ...rowStyle, border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>{order.order_number ?? `Order #${order.id}`}</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{order.customer_name}</div>
                  <div style={{ color: '#666', marginTop: '0.2rem' }}>{new Date(order.created_at).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700 }}>Total: ৳{subtotal.toFixed(2)}</div>
                  <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ ...statusBadgeStyle(order.urgency_status), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{statusLabel(order.urgency_status)}</span>
                    <span style={{ ...statusBadgeStyle(order.confirmation_status), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{statusLabel(order.confirmation_status)}</span>
                    <span style={{ ...statusBadgeStyle(order.delivery_status), borderRadius: '999px', padding: '0.25rem 0.6rem' }}>{statusLabel(order.delivery_status)}</span>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', color: '#374151' }}>
                <strong>Items:</strong> {itemSummary || 'No items'}
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                <Link href={`/orders/${order.id}`} style={{ color: '#a83aa3', fontWeight: 600 }}>Open order →</Link>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
