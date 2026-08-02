import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { PAGE_SIZE_OPTIONS, parsePageParams, rangeFor, buildQueryHref } from '@/lib/pagination';
import { getVisibleNeedsReviewReasons } from '@/lib/needsReviewFlags';
import OrdersList from '@/app/orders/OrdersList';

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
};

type ArchivedPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function ArchivedOrdersPage({ searchParams }: ArchivedPageProps) {
  await requireAdmin();

  if (!supabaseAdmin) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1>Archived orders</h1>
        <p>Supabase is not configured yet.</p>
      </div>
    );
  }

  const { page, pageSize } = parsePageParams(searchParams);
  const [from, to] = rangeFor(page, pageSize);

  const query = supabaseAdmin
    .from('orders')
    .select('id, order_number, order_source, customer_name, phone, address, urgency_type, urgency_target_date, confirmation_status, delivery_status, created_at, total_amount, archived_at, needs_review, needs_review_reasons, order_items(sku, product_name, quantity, unit_price), contact_attempts(type, count, first_logged_at)', { count: 'exact' })
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
    .range(from, to);

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
        <h1>Archived orders</h1>
        <p>Unable to load orders: {errorMessage}</p>
      </div>
    );
  }

  const rawOrders = (data ?? []) as Omit<OrderRow, 'visible_needs_review_reasons'>[];
  const visibleReasonsByOrder = await getVisibleNeedsReviewReasons(supabaseAdmin, rawOrders);
  const orders: OrderRow[] = rawOrders.map((order) => ({
    ...order,
    visible_needs_review_reasons: visibleReasonsByOrder.get(order.id) ?? [],
  }));

  const currentParams: Record<string, string> = { page_size: String(pageSize) };
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const prevHref = page > 1 ? buildQueryHref('/settings/archived', currentParams, { page: page - 1 }) : null;
  const nextHref = page < totalPages ? buildQueryHref('/settings/archived', currentParams, { page: page + 1 }) : null;
  const pageSizeHrefs = PAGE_SIZE_OPTIONS.map((size) => ({ size, href: buildQueryHref('/settings/archived', currentParams, { page_size: size, page: 1 }) }));

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>Archived orders <span style={{ color: '#666', fontWeight: 400, fontSize: '1.1rem' }}>({totalCount})</span></h1>
          <p>Hidden from every normal view -- restore one to bring it back into the active queue.</p>
        </div>
        <Link href="/settings" className="nav-pill">← Back to settings</Link>
      </div>

      <div className="card">
        <OrdersList
          orders={orders}
          view="archived"
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
