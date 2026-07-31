import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

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

function statusBadgeStyle(status: string) {
  const styles: Record<string, React.CSSProperties> = {
    normal: { background: '#e8f5e9', color: '#2e7d32' },
    urgent: { background: '#ffebee', color: '#c62828' },
    hold: { background: '#fff8e1', color: '#ef6c00' },
    pending: { background: '#f3e5f5', color: '#6a1b9a' },
    x1: { background: '#e3f2fd', color: '#1565c0' },
    x2: { background: '#e1f5fe', color: '#0277bd' },
    x3: { background: '#ede7f6', color: '#512da8' },
    confirmed: { background: '#e8f5e9', color: '#2e7d32' },
    cancelled: { background: '#f5f5f5', color: '#616161' },
    packaging: { background: '#f3e5f5', color: '#6a1b9a' },
    sent_to_courier: { background: '#e0f7fa', color: '#00838f' },
    delivered: { background: '#e8f5e9', color: '#2e7d32' },
    returned: { background: '#fff3e0', color: '#ef6c00' },
  };

  return styles[status] ?? { background: '#f5f5f5', color: '#616161' };
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
  const dateFrom = getParam(searchParams?.date_from);
  const dateTo = getParam(searchParams?.date_to);

  let query = supabaseAdmin
    .from('orders')
    .select('id, customer_name, urgency_status, confirmation_status, delivery_status, created_at, total_amount, order_items(sku, product_name, quantity, unit_price)')
    .order('created_at', { ascending: false });

  if (view === 'ready-for-delivery') {
    query = query.in('delivery_status', ['sent_to_courier', 'delivered']);
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

  const orders = (data ?? []) as OrderRow[];

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Orders</h1>
          <p style={{ margin: 0, color: '#666' }}>A practical view of order headers plus their line items.</p>
        </div>
        <Link href="/orders/new" style={{ textDecoration: 'none', fontWeight: 600 }}>Add order</Link>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link href="/orders" style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', textDecoration: 'none', color: '#111' }}>
          All
        </Link>
        <Link href={buildHref({ view: 'ready-for-delivery' })} style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', textDecoration: 'none', color: '#111' }}>
          Ready for delivery
        </Link>
        <Link href="/reports/products-by-date" style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', textDecoration: 'none', color: '#111' }}>
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
        <select name="urgency_status" defaultValue={urgency}>
          <option value="">All urgencies</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
          <option value="hold">Hold</option>
        </select>
        <select name="confirmation_status" defaultValue={confirmation}>
          <option value="">All confirmations</option>
          <option value="pending">Pending</option>
          <option value="x1">x1</option>
          <option value="x2">x2</option>
          <option value="x3">x3</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select name="delivery_status" defaultValue={delivery}>
          <option value="">All deliveries</option>
          <option value="packaging">Packaging</option>
          <option value="sent_to_courier">Sent to courier</option>
          <option value="delivered">Delivered</option>
          <option value="returned">Returned</option>
        </select>
        <button type="submit">Apply</button>
        <Link href="/orders" style={{ padding: '0.35rem 0.6rem', border: '1px solid #ccc', textDecoration: 'none', color: '#111' }}>
          Clear
        </Link>
      </form>

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
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>Order #{order.id}</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{order.customer_name}</div>
                  <div style={{ color: '#666', marginTop: '0.2rem' }}>{new Date(order.created_at).toLocaleString()}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700 }}>Total: ৳{subtotal.toFixed(2)}</div>
                  <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ ...statusBadgeStyle(order.urgency_status), borderRadius: '999px', padding: '0.25rem 0.6rem', textTransform: 'capitalize' }}>{order.urgency_status}</span>
                    <span style={{ ...statusBadgeStyle(order.confirmation_status), borderRadius: '999px', padding: '0.25rem 0.6rem', textTransform: 'capitalize' }}>{order.confirmation_status}</span>
                    <span style={{ ...statusBadgeStyle(order.delivery_status), borderRadius: '999px', padding: '0.25rem 0.6rem', textTransform: 'capitalize' }}>{order.delivery_status}</span>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', color: '#374151' }}>
                <strong>Items:</strong> {itemSummary || 'No items'}
              </div>

              <div style={{ marginTop: '0.75rem' }}>
                <Link href={`/orders/${order.id}`}>Open order</Link>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
