import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { HISTORY_DELIVERY_STATUSES, confirmationStatusOptions, statusLabel } from '@/lib/theme';
import { PAGE_SIZE_OPTIONS, parsePageParams, rangeFor, buildQueryHref } from '@/lib/pagination';
import { getVisibleNeedsReviewReasons } from '@/lib/needsReviewFlags';
import OrdersList from '../orders/OrdersList';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OrderItem = {
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
};

type ContactAttempt = {
  type: string;
  count: number;
  first_logged_at: string | null;
};

type OrderRow = {
  id: number;
  order_number: string | null;
  customer_name: string;
  phone: string;
  address: string;
  urgency_type: string;
  urgency_target_date: string | null;
  confirmation_status: string;
  delivery_status: string;
  created_at: string;
  total_amount: number | null;
  archived_at: string | null;
  needs_review: boolean;
  needs_review_reasons: string[] | null;
  visible_needs_review_reasons: string[];
  order_items: OrderItem[];
  contact_attempts: ContactAttempt[];
};

type HistoryPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  if (!supabaseAdmin) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>History</h1>
        <p>Supabase is not configured yet.</p>
      </main>
    );
  }

  const urgency = getParam(searchParams?.urgency_type);
  const confirmation = getParam(searchParams?.confirmation_status);
  const delivery = getParam(searchParams?.delivery_status);
  const dateFrom = getParam(searchParams?.date_from);
  const dateTo = getParam(searchParams?.date_to);
  const { page, pageSize } = parsePageParams(searchParams);

  let query = supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_name, phone, address, urgency_type, urgency_target_date, confirmation_status, delivery_status, created_at, total_amount, archived_at, needs_review, needs_review_reasons, order_items(sku, product_name, quantity, unit_price), contact_attempts(type, count, first_logged_at)', { count: 'exact' })
    .is('archived_at', null)
    .in('delivery_status', delivery ? [delivery] : HISTORY_DELIVERY_STATUSES)
    .order('created_at', { ascending: false });

  if (urgency) {
    query = query.eq('urgency_type', urgency);
  }
  if (confirmation) {
    query = query.eq('confirmation_status', confirmation);
  }

  if (dateFrom) {
    query = query.gte('created_at', `${dateFrom}T00:00:00+06:00`);
  }
  if (dateTo) {
    query = query.lte('created_at', `${dateTo}T23:59:59.999+06:00`);
  }

  const [from, to] = rangeFor(page, pageSize);
  query = query.range(from, to);

  let data: any[] | null = null;
  let totalCount = 0;
  let errorMessage = '';

  try {
    const result = await query;
    data = result.data as any[] | null;
    totalCount = result.count ?? 0;
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
        <h1>History</h1>
        <p>Unable to load orders: {errorMessage}</p>
      </main>
    );
  }

  const rawOrders = (data ?? []) as Omit<OrderRow, 'visible_needs_review_reasons'>[];
  const visibleReasonsByOrder = await getVisibleNeedsReviewReasons(supabaseAdmin, rawOrders);
  const orders: OrderRow[] = rawOrders.map((order) => ({
    ...order,
    visible_needs_review_reasons: visibleReasonsByOrder.get(order.id) ?? [],
  }));

  const currentParams: Record<string, string> = {
    ...(urgency ? { urgency_type: urgency } : {}),
    ...(confirmation ? { confirmation_status: confirmation } : {}),
    ...(delivery ? { delivery_status: delivery } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    page_size: String(pageSize),
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const prevHref = page > 1 ? buildQueryHref('/history', currentParams, { page: page - 1 }) : null;
  const nextHref = page < totalPages ? buildQueryHref('/history', currentParams, { page: page + 1 }) : null;
  const pageSizeHrefs = PAGE_SIZE_OPTIONS.map((size) => ({ size, href: buildQueryHref('/history', currentParams, { page_size: size, page: 1 }) }));

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>History</h1>
          <p style={{ margin: 0, color: '#666' }}>Orders already sent to courier or delivered -- the equivalent of the old Weblog sheet.</p>
        </div>
        <Link href="/orders" className="nav-pill">← Back to active orders</Link>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <Link href="/orders" className="nav-pill">Orders</Link>
        <Link href="/history" className="nav-pill active">History</Link>
        <Link href="/reports/products-by-date" className="nav-pill">Products by date report</Link>
        <Link href="/reports/attention-needed" className="nav-pill">Attention Needed</Link>
        <Link href="/reports/feedback" className="nav-pill">Feedback report</Link>
      </div>

      <form action="/history" method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          From
          <input type="date" name="date_from" defaultValue={dateFrom} />
        </label>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          To
          <input type="date" name="date_to" defaultValue={dateTo} />
        </label>
        <select name="urgency_type" defaultValue={urgency}>
          <option value="">All urgencies</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
          <option value="hold">Hold</option>
          <option value="vu">VU (Very Urgent)</option>
          <option value="d">D (Dispatch)</option>
        </select>
        <select name="confirmation_status" defaultValue={confirmation}>
          <option value="">All confirmations</option>
          {confirmationStatusOptions.map((status) => (
            <option key={status} value={status}>{statusLabel(status)}</option>
          ))}
        </select>
        {/* only these two statuses are ever "history" -- packaging/returned live on /orders */}
        <select name="delivery_status" defaultValue={delivery}>
          <option value="">Sent to courier + Delivered</option>
          <option value="sent_to_courier">Sent to courier</option>
          <option value="delivered">Delivered</option>
        </select>
        <button type="submit">Apply</button>
        <Link href="/history" className="nav-pill">
          Clear
        </Link>
      </form>

      <OrdersList
        orders={orders}
        view=""
        bucket="history"
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        prevHref={prevHref}
        nextHref={nextHref}
        pageSizeHrefs={pageSizeHrefs}
        itemLabel="orders"
      />
    </main>
  );
}
