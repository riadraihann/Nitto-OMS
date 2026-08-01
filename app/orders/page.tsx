import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { CALL_PENDING_STAGES, HISTORY_DELIVERY_STATUSES, confirmationStatusOptions, statusLabel } from '@/lib/theme';
import { PAGE_SIZE_OPTIONS, parsePageParams, rangeFor, buildQueryHref } from '@/lib/pagination';
import { getVisibleNeedsReviewReasons } from '@/lib/needsReviewFlags';
import { computeCallPendingStats } from '@/lib/callPendingStats';
import StatTile from '@/app/components/StatTile';
import OrdersList from './OrdersList';

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
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1>Orders</h1>
        <p>Supabase is not configured yet.</p>
      </div>
    );
  }

  const urgency = getParam(searchParams?.urgency_type);
  const confirmation = getParam(searchParams?.confirmation_status);
  const delivery = getParam(searchParams?.delivery_status);
  const view = getParam(searchParams?.view);
  const sort = getParam(searchParams?.sort) || 'date';
  const dateFrom = getParam(searchParams?.date_from);
  const dateTo = getParam(searchParams?.date_to);
  const { page, pageSize } = parsePageParams(searchParams);

  let query = supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_name, phone, address, urgency_type, urgency_target_date, confirmation_status, delivery_status, created_at, total_amount, archived_at, needs_review, needs_review_reasons, order_items(sku, product_name, quantity, unit_price), contact_attempts(type, count, first_logged_at)', { count: 'exact' });

  // /orders is the active working queue -- shipped orders (sent to courier or delivered) live
  // on /history instead, and archived orders live under Settings -> Archived. This applies to
  // every sub-view here (default, call-pending, needs-review, cancelled): none of them are
  // meaningful for an order that's already shipped or archived.
  query = query.is('archived_at', null).not('delivery_status', 'in', `(${HISTORY_DELIVERY_STATUSES.join(',')})`);

  if (view === 'call-pending') {
    query = query.eq('order_source', 'shopify').in('confirmation_status', CALL_PENDING_STAGES);
  } else if (view === 'needs-review') {
    query = query.eq('needs_review', true);
  } else if (view === 'cancelled') {
    query = query.eq('confirmation_status', 'cancelled');
  } else {
    if (urgency) {
      query = query.eq('urgency_type', urgency);
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

  // "sort by confirmation stage" (Call Pending only): a leftover from when confirmation_status
  // itself carried pending/x1/x2/x3 -- Call Pending is now scoped to a single value ('pending'),
  // so this is a harmless no-op identical to date sort, not actively removed since it doesn't
  // produce wrong output, just redundant with the date option.
  if (view === 'call-pending' && sort === 'stage') {
    query = query.order('confirmation_status', { ascending: true }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
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
        <h1>Orders</h1>
        <p>Unable to load orders: {errorMessage}</p>
      </div>
    );
  }

  const rawOrders = (data ?? []) as Omit<OrderRow, 'visible_needs_review_reasons'>[];
  const [visibleReasonsByOrder, callPendingStats] = await Promise.all([
    getVisibleNeedsReviewReasons(supabaseAdmin, rawOrders),
    view === 'call-pending' ? computeCallPendingStats() : Promise.resolve(null),
  ]);
  let orders: OrderRow[] = rawOrders.map((order) => ({
    ...order,
    visible_needs_review_reasons: visibleReasonsByOrder.get(order.id) ?? [],
  }));

  // an order stays in this filtered view only while it has at least one visible (unactioned or
  // ignored-but-still-active-elsewhere) reason -- one that's fully resolved/ignored across all
  // its reasons no longer "needs review" for this list's purposes, even though the raw
  // needs_review column (used for the DB-side filter above) is still true.
  if (view === 'needs-review') {
    orders = orders.filter((order) => order.visible_needs_review_reasons.length > 0);
  }

  const currentParams: Record<string, string> = {
    ...(view ? { view } : {}),
    ...(urgency ? { urgency_type: urgency } : {}),
    ...(confirmation ? { confirmation_status: confirmation } : {}),
    ...(delivery ? { delivery_status: delivery } : {}),
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    ...(sort !== 'date' ? { sort } : {}),
    page_size: String(pageSize),
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const prevHref = page > 1 ? buildQueryHref('/orders', currentParams, { page: page - 1 }) : null;
  const nextHref = page < totalPages ? buildQueryHref('/orders', currentParams, { page: page + 1 }) : null;
  const pageSizeHrefs = PAGE_SIZE_OPTIONS.map((size) => ({ size, href: buildQueryHref('/orders', currentParams, { page_size: size, page: 1 }) }));

  const viewTitles: Record<string, { title: string; subtitle: string }> = {
    '': { title: 'Orders', subtitle: 'The active working queue -- shipped orders live on the History tab.' },
    'call-pending': { title: 'Call Pending', subtitle: 'Shopify orders still awaiting a confirmation call.' },
    'needs-review': { title: 'Needs Review', subtitle: 'Orders flagged by a data-integrity check.' },
    'cancelled': { title: 'Cancelled', subtitle: 'Orders marked cancelled -- still in the active queue, not archived.' },
  };
  const { title, subtitle } = viewTitles[view] ?? viewTitles[''];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>{title} <span style={{ color: '#666', fontWeight: 400, fontSize: '1.1rem' }}>({totalCount})</span></h1>
          <p>{subtitle}</p>
        </div>
        <Link href="/orders/new" style={{ textDecoration: 'none' }}>
          <button type="button">+ Add order</button>
        </Link>
      </div>

      <div className="card">
        <form action="/orders" method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="hidden" name="view" value={view} />
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
            From
            <input type="date" name="date_from" defaultValue={dateFrom} />
          </label>
          <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
            To
            <input type="date" name="date_to" defaultValue={dateTo} />
          </label>
          {view !== 'call-pending' && view !== 'needs-review' && view !== 'cancelled' ? (
            <>
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
              {/* sent_to_courier/delivered live on /history -- offering them here would always
                  return zero rows, since the base query already excludes them */}
              <select name="delivery_status" defaultValue={delivery}>
                <option value="">All deliveries</option>
                <option value="packaging">Packaging</option>
                <option value="returned">Returned</option>
              </select>
            </>
          ) : null}
          <button type="submit" className="btn-secondary">Apply</button>
          <Link href="/orders" className="nav-pill">
            Clear
          </Link>
        </form>

        {view === 'call-pending' ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: 'var(--space-3)', fontSize: '0.9rem' }}>
            <span style={{ color: '#666' }}>Sort by:</span>
            <Link href={buildHref({ view: 'call-pending', sort: 'date' })} className={`nav-pill${sort !== 'stage' ? ' active' : ''}`}>
              Date (newest first)
            </Link>
            <Link href={buildHref({ view: 'call-pending', sort: 'stage' })} className={`nav-pill${sort === 'stage' ? ' active' : ''}`}>
              Confirmation stage
            </Link>
          </div>
        ) : null}
      </div>

      {callPendingStats ? (
        <div className="card">
          <div className="stat-grid">
            <StatTile label="Active attempts" value={callPendingStats.activeAttempts} sublabel="X1/X2/X3, Unreachable, or Phone off logged" />
            <StatTile label="Fully pending" value={callPendingStats.fullyPending} sublabel="No attempts logged yet" />
            <StatTile
              label="Today's confirmation rate"
              value={
                callPendingStats.confirmationRate.denominator > 0
                  ? `${Math.round((callPendingStats.confirmationRate.numerator / callPendingStats.confirmationRate.denominator) * 100)}%`
                  : '—'
              }
              sublabel={
                callPendingStats.confirmationRate.denominator > 0
                  ? `confirmed today (${callPendingStats.confirmationRate.numerator}/${callPendingStats.confirmationRate.denominator})`
                  : 'No confirmation activity yet today'
              }
              accent="good"
            />
          </div>
        </div>
      ) : null}

      <div className="card">
        <OrdersList
          orders={orders}
          view={view}
          bucket="active"
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
