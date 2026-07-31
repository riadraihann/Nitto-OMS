import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { PAGE_SIZE_OPTIONS, parsePageParams, rangeFor, buildQueryHref } from '@/lib/pagination';
import PaginationBar from '@/app/components/PaginationBar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type FeedbackRow = {
  id: number;
  order_number: string | null;
  customer_name: string;
  created_at: string;
  happiness_score: number | null;
  product_suggestions: string | null;
};

type ReportPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

const FEEDBACK_FILTER = 'happiness_score.not.is.null,product_suggestions.not.is.null';

export default async function FeedbackReportPage({ searchParams }: ReportPageProps) {
  if (!supabaseAdmin) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Feedback report</h1>
        <p>Supabase is not configured yet.</p>
      </main>
    );
  }

  const dateFrom = getParam(searchParams?.date_from);
  const dateTo = getParam(searchParams?.date_to);
  const { page, pageSize } = parsePageParams(searchParams);

  const applyFilters = (q: any) => {
    let query = q.is('archived_at', null).or(FEEDBACK_FILTER);
    if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00+06:00`);
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999+06:00`);
    return query;
  };

  const [from, to] = rangeFor(page, pageSize);

  let rows: FeedbackRow[] = [];
  let totalCount = 0;
  let avgHappiness: number | null = null;
  let suggestionCount = 0;
  let errorMessage = '';

  try {
    const pageQuery = applyFilters(
      supabaseAdmin
        .from('orders')
        .select('id, order_number, customer_name, created_at, happiness_score, product_suggestions', { count: 'exact' }),
    )
      .order('created_at', { ascending: false })
      .range(from, to);

    // aggregate stats (average happiness, suggestion count) need to cover the FULL filtered
    // range, not just the current page -- a separate lightweight query for just those two
    // columns, rather than fetching every full row twice
    const aggQuery = applyFilters(supabaseAdmin.from('orders').select('happiness_score, product_suggestions'));

    const [pageResult, aggResult] = await Promise.all([pageQuery, aggQuery]);

    if (pageResult.error) throw pageResult.error;
    if (aggResult.error) throw aggResult.error;

    rows = (pageResult.data ?? []) as FeedbackRow[];
    totalCount = pageResult.count ?? 0;

    const aggRows = (aggResult.data ?? []) as { happiness_score: number | null; product_suggestions: string | null }[];
    const scores = aggRows.filter((r) => r.happiness_score !== null).map((r) => Number(r.happiness_score));
    avgHappiness = scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null;
    suggestionCount = aggRows.filter((r) => r.product_suggestions && r.product_suggestions.trim()).length;
  } catch (error: any) {
    const { message, code, details, hint } = error ?? {};
    errorMessage = [message, code && `code=${code}`, details, hint].filter(Boolean).join(' | ') || 'Unknown error';
  }

  if (errorMessage) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Feedback report</h1>
        <p>Unable to load report: {errorMessage}</p>
      </main>
    );
  }

  const currentParams: Record<string, string> = {
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
    page_size: String(pageSize),
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const prevHref = page > 1 ? buildQueryHref('/reports/feedback', currentParams, { page: page - 1 }) : null;
  const nextHref = page < totalPages ? buildQueryHref('/reports/feedback', currentParams, { page: page + 1 }) : null;
  const pageSizeHrefs = PAGE_SIZE_OPTIONS.map((size) => ({ size, href: buildQueryHref('/reports/feedback', currentParams, { page_size: size, page: 1 }) }));

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Feedback report</h1>
          <p style={{ margin: 0, color: '#666' }}>Orders with a happiness score and/or product suggestions recorded.</p>
        </div>
        <Link href="/orders" className="nav-pill">← Back to orders</Link>
      </div>

      <form action="/reports/feedback" method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          From
          <input type="date" name="date_from" defaultValue={dateFrom} />
        </label>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          To
          <input type="date" name="date_to" defaultValue={dateTo} />
        </label>
        <button type="submit">Apply</button>
        <Link href="/reports/feedback" className="nav-pill">
          Clear
        </Link>
      </form>

      <div style={{ borderLeft: '4px solid #0a2472', background: '#eaeef7', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem', fontWeight: 700, color: '#0a2472' }}>
        {totalCount} order{totalCount === 1 ? '' : 's'} with feedback · Average happiness score: {avgHappiness !== null ? avgHappiness.toFixed(2) : 'n/a'} · {suggestionCount} with product suggestions
      </div>

      <PaginationBar
        variant="compact"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        visibleCount={rows.length}
        itemLabel="orders"
        prevHref={prevHref}
        nextHref={nextHref}
        pageSizeHrefs={pageSizeHrefs}
      />

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {rows.map((row) => (
          <article key={row.id} style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.9rem', color: '#666' }}>{row.order_number ?? `Order #${row.id}`}</div>
                <Link href={`/orders/${row.id}`} style={{ fontSize: '1.05rem', fontWeight: 700, color: '#a83aa3' }}>{row.customer_name}</Link>
                <div style={{ color: '#666', marginTop: '0.15rem', fontSize: '0.85rem' }}>{new Date(row.created_at).toLocaleString()}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>{row.happiness_score !== null ? `Happiness: ${row.happiness_score}` : 'No score'}</div>
              </div>
            </div>
            {row.product_suggestions ? (
              <div style={{ marginTop: '0.6rem', color: '#374151', fontSize: '0.9rem' }}>
                <strong>Suggestion:</strong> {row.product_suggestions}
              </div>
            ) : null}
          </article>
        ))}
        {rows.length === 0 ? <p style={{ color: '#666' }}>No feedback recorded for this range.</p> : null}
      </div>

      <PaginationBar
        variant="full"
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        visibleCount={rows.length}
        itemLabel="orders"
        prevHref={prevHref}
        nextHref={nextHref}
        pageSizeHrefs={pageSizeHrefs}
      />
    </main>
  );
}
