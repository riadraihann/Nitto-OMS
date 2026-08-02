import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { HISTORY_DELIVERY_STATUSES, confirmationStatusOptions, statusLabel } from '@/lib/theme';
import { PAGE_SIZE_OPTIONS, parsePageParams, rangeFor, buildQueryHref } from '@/lib/pagination';
import { getVisibleNeedsReviewReasons } from '@/lib/needsReviewFlags';
import { dhakaDayString, formatDhakaDateLong } from '@/lib/dhakaTime.mjs';
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
  order_source: string;
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
  dispatch_date: string | null;
  groupHeader?: string | null;
};

const SELECT_COLUMNS =
  'id, order_number, order_source, customer_name, phone, address, urgency_type, urgency_target_date, confirmation_status, delivery_status, created_at, total_amount, archived_at, needs_review, needs_review_reasons, dispatch_date, order_items(sku, product_name, quantity, unit_price), contact_attempts(type, count, first_logged_at)';

type HistoryPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  if (!supabaseAdmin) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1>History</h1>
        <p>Supabase is not configured yet.</p>
      </div>
    );
  }

  const urgency = getParam(searchParams?.urgency_type);
  const confirmation = getParam(searchParams?.confirmation_status);
  const delivery = getParam(searchParams?.delivery_status);
  const dateFrom = getParam(searchParams?.date_from);
  const dateTo = getParam(searchParams?.date_to);
  const { page, pageSize } = parsePageParams(searchParams);

  // Grouped by dispatch_date (courier_handoff_date, or delivered_date as a fallback for orders
  // with no tracked hand-off -- see supabase/add_dispatch_dates.sql), not created_at: History is
  // "what shipped when," and for the June-import backlog in particular, creation date and
  // dispatch date can be days apart. date_from/date_to below filter on this same dispatch_date,
  // so what's typed into the filter matches what's now grouped/sorted by.
  let query = supabaseAdmin
    .from('orders')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .is('archived_at', null)
    .in('delivery_status', delivery ? [delivery] : HISTORY_DELIVERY_STATUSES)
    .not('dispatch_date', 'is', null)
    .order('dispatch_date', { ascending: false });

  if (urgency) {
    query = query.eq('urgency_type', urgency);
  }
  if (confirmation) {
    query = query.eq('confirmation_status', confirmation);
  }

  if (dateFrom) {
    query = query.gte('dispatch_date', `${dateFrom}T00:00:00+06:00`);
  }
  if (dateTo) {
    query = query.lte('dispatch_date', `${dateTo}T23:59:59.999+06:00`);
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
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1>History</h1>
        <p>Unable to load orders: {errorMessage}</p>
      </div>
    );
  }

  // Orders with no recorded dispatch date at all (a handful of live orders that reached
  // sent_to_courier/delivered before this column existed, with no order_history log of the
  // transition either -- see supabase/add_dispatch_dates.sql) -- shown as their own explicit
  // section rather than silently guessed from created_at. The full list is only fetched on page 1
  // of an unfiltered-by-date view (paginating this separately from the dated list would be more
  // machinery than a handful of edge-case orders warrants), but the *count* is fetched on every
  // page/filter combination so the h1 total always matches the sidebar's History badge -- both
  // count every order in History, not just the ones with a known dispatch date.
  let unknownQueryBase = supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null)
    .in('delivery_status', delivery ? [delivery] : HISTORY_DELIVERY_STATUSES)
    .is('dispatch_date', null);
  if (urgency) unknownQueryBase = unknownQueryBase.eq('urgency_type', urgency);
  if (confirmation) unknownQueryBase = unknownQueryBase.eq('confirmation_status', confirmation);
  const { count: unknownCount } = await unknownQueryBase;

  let unknownOrders: OrderRow[] = [];
  if (page === 1 && !dateFrom && !dateTo) {
    let unknownQuery = supabaseAdmin
      .from('orders')
      .select(SELECT_COLUMNS)
      .is('archived_at', null)
      .in('delivery_status', delivery ? [delivery] : HISTORY_DELIVERY_STATUSES)
      .is('dispatch_date', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (urgency) unknownQuery = unknownQuery.eq('urgency_type', urgency);
    if (confirmation) unknownQuery = unknownQuery.eq('confirmation_status', confirmation);
    const unknownResult = await unknownQuery;
    unknownOrders = (unknownResult.data ?? []) as OrderRow[];
  }

  const rawOrders = (data ?? []) as Omit<OrderRow, 'visible_needs_review_reasons'>[];
  const allRawOrders = [...rawOrders, ...unknownOrders];
  const visibleReasonsByOrder = await getVisibleNeedsReviewReasons(supabaseAdmin, allRawOrders);

  const orders: OrderRow[] = rawOrders.map((order, index) => {
    const day = order.dispatch_date ? dhakaDayString(order.dispatch_date) : null;
    const previousDay = index > 0 ? dhakaDayString(rawOrders[index - 1].dispatch_date as string) : null;
    return {
      ...order,
      visible_needs_review_reasons: visibleReasonsByOrder.get(order.id) ?? [],
      groupHeader: day && day !== previousDay ? formatDhakaDateLong(order.dispatch_date) : null,
    };
  });

  const unknownOrdersWithReasons: OrderRow[] = unknownOrders.map((order) => ({
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
  // Every order in History, dispatch-dated or not -- matches the sidebar's History badge, which
  // counts the same way. The paginated list below (and its own "Showing X of Y") only covers the
  // dispatch-dated subset; the "Unknown dispatch date" section makes up the difference.
  const grandTotal = totalCount + (unknownCount ?? 0);

  return (
    <div className="history-page" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="history-banner">
        <span>History — completed orders</span>
        <span className="history-banner-sub">Already sent to courier or delivered. Read-only status -- open an order to correct it.</span>
      </div>

      <div className="page-header">
        <div>
          <h1>History <span style={{ color: '#666', fontWeight: 400, fontSize: '1.1rem' }}>({grandTotal})</span></h1>
          <p>Grouped by dispatch date (sent-to-courier, or delivered where that isn't tracked) -- not order date.</p>
        </div>
        <Link href="/orders" className="nav-pill">← Back to active orders</Link>
      </div>

      <div className="card">
        <form action="/history" method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
            Dispatched from
            <input type="date" name="date_from" defaultValue={dateFrom} />
          </label>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
            to
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
          <button type="submit" className="btn-secondary">Apply</button>
          <Link href="/history" className="nav-pill">
            Clear
          </Link>
        </form>
      </div>

      {unknownOrdersWithReasons.length > 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Unknown dispatch date ({unknownCount ?? unknownOrdersWithReasons.length})</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.5rem' }}>
            Reached History before dispatch dates were tracked, with no record of when -- shown separately rather than guessed.
            {(unknownCount ?? 0) > unknownOrdersWithReasons.length ? ` Showing the first ${unknownOrdersWithReasons.length}.` : ''}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 'var(--space-3)' }}>
            {unknownOrdersWithReasons.map((order) => {
              const itemSummary = (order.order_items ?? []).map((item) => `${item.quantity} × ${item.sku || item.product_name}`).join(', ');
              const computedSubtotal = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
              const subtotal = order.total_amount ?? computedSubtotal;
              return (
                <Link key={order.id} href={`/orders/${order.id}`} className="order-card" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="order-card-top">
                    <span className="order-card-name">{order.customer_name}</span>
                  </div>
                  <span className="order-card-phone">{order.phone}</span>
                  <div className="order-card-total">৳{subtotal.toFixed(2)}</div>
                  <div className="order-card-items">{itemSummary || 'No items'}</div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="card">
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
      </div>
    </div>
  );
}
