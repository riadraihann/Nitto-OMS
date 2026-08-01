import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OrderItem = {
  product_name: string;
  quantity: number;
  unit_price: number;
};

type OrderRow = {
  created_at: string;
  total_amount: number | null;
  order_items: OrderItem[];
};

type ReportPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

// order_items only stores a single product_name string (e.g. "Snuggly Palazzo - Black, XL"),
// there's no separate color/size column. We treat the text before the first " - " as the base
// product and everything after as the variant, so grand totals can roll up across variants.
// Product names that don't follow that "Base - Variant" pattern are left ungrouped (base = full name).
function splitVariant(productName: string): { base: string; variant: string } {
  const idx = productName.indexOf(' - ');
  if (idx === -1) return { base: productName, variant: '' };
  return { base: productName.slice(0, idx).trim(), variant: productName.slice(idx + 3).trim() };
}

async function fetchOrdersInRange(dateFrom: string, dateTo: string) {
  const supabase = supabaseAdmin!;
  const PAGE = 1000;
  let all: OrderRow[] = [];
  let from = 0;

  for (;;) {
    let query = supabase
      .from('orders')
      .select('created_at, total_amount, order_items(product_name, quantity, unit_price)')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);

    if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00+06:00`);
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999+06:00`);

    const { data, error } = await query;
    if (error) throw error;
    all = all.concat(data as OrderRow[]);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

export default async function ProductsByDatePage({ searchParams }: ReportPageProps) {
  await requireAdmin();

  if (!supabaseAdmin) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Products by date</h1>
        <p>Supabase is not configured yet.</p>
      </main>
    );
  }

  const dateFrom = getParam(searchParams?.date_from);
  const dateTo = getParam(searchParams?.date_to);

  let orders: OrderRow[] = [];
  let errorMessage = '';

  try {
    orders = await fetchOrdersInRange(dateFrom, dateTo);
  } catch (error: any) {
    const { message, code, details, hint } = error ?? {};
    errorMessage = [message, code && `code=${code}`, details, hint].filter(Boolean).join(' | ') || 'Unknown error';
  }

  if (errorMessage) {
    return (
      <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
        <h1>Products by date</h1>
        <p>Unable to load report: {errorMessage}</p>
      </main>
    );
  }

  // group by exact product_name (variant string as-is), then roll those up by base product
  type VariantAgg = { productName: string; quantity: number; subtotal: number };
  type BaseAgg = { base: string; quantity: number; subtotal: number; variants: Map<string, VariantAgg> };

  const baseGroups = new Map<string, BaseAgg>();

  for (const order of orders) {
    const items = order.order_items ?? [];
    const computedTotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    // sheet-synced orders (both the June import and the live "Real Todays" sync) only ever
    // carry a single order-level bill amount -- there's no real per-item price, so every
    // item.unit_price is 0. Rather than reporting every sheet-sourced product as worth ৳0,
    // distribute the order's total proportionally by quantity across its items. This is an
    // approximation (assumes uniform per-unit pricing within the order), not real per-item
    // pricing, but it's the best available without that data.
    const useDistributedValue = computedTotal === 0 && order.total_amount != null && totalQuantity > 0;

    for (const item of items) {
      const { base } = splitVariant(item.product_name);
      const lineSubtotal = useDistributedValue
        ? (item.quantity / totalQuantity) * (order.total_amount as number)
        : item.quantity * item.unit_price;

      if (!baseGroups.has(base)) {
        baseGroups.set(base, { base, quantity: 0, subtotal: 0, variants: new Map() });
      }
      const baseAgg = baseGroups.get(base)!;
      baseAgg.quantity += item.quantity;
      baseAgg.subtotal += lineSubtotal;

      if (!baseAgg.variants.has(item.product_name)) {
        baseAgg.variants.set(item.product_name, { productName: item.product_name, quantity: 0, subtotal: 0 });
      }
      const variantAgg = baseAgg.variants.get(item.product_name)!;
      variantAgg.quantity += item.quantity;
      variantAgg.subtotal += lineSubtotal;
    }
  }

  const sortedBaseGroups = Array.from(baseGroups.values())
    .sort((a, b) => b.quantity - a.quantity)
    .map((group) => ({
      ...group,
      variants: Array.from(group.variants.values()).sort((a, b) => b.quantity - a.quantity),
    }));

  const grandTotalQuantity = sortedBaseGroups.reduce((sum, g) => sum + g.quantity, 0);
  const grandTotalValue = sortedBaseGroups.reduce((sum, g) => sum + g.subtotal, 0);

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.25rem' }}>Products by date</h1>
          <p style={{ margin: 0, color: '#666' }}>Quantity and value ordered per product, grouped by variant with grand totals per product.</p>
        </div>
        <Link href="/orders" className="nav-pill">← Back to orders</Link>
      </div>

      <form action="/reports/products-by-date" method="get" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          From
          <input type="date" name="date_from" defaultValue={dateFrom} />
        </label>
        <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.9rem' }}>
          To
          <input type="date" name="date_to" defaultValue={dateTo} />
        </label>
        <button type="submit">Apply</button>
        <Link href="/reports/products-by-date" className="nav-pill">
          Clear
        </Link>
      </form>

      {!dateFrom && !dateTo ? (
        <p style={{ color: '#666', fontStyle: 'italic', marginBottom: '1rem' }}>Showing all-time data. Pick a date or range above to narrow it down.</p>
      ) : null}

      <div style={{ borderLeft: '4px solid #0a2472', background: '#eaeef7', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem', fontWeight: 700, color: '#0a2472' }}>
        Grand total: {grandTotalQuantity} items · ৳{grandTotalValue.toFixed(2)}
      </div>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {sortedBaseGroups.map((group) => (
          <article key={group.base} style={{ border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{group.base}</h2>
              <div style={{ fontWeight: 700, color: '#a83aa3' }}>{group.quantity} items · ৳{group.subtotal.toFixed(2)}</div>
            </div>

            {group.variants.length > 1 || group.variants[0]?.productName !== group.base ? (
              <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.25rem' }}>
                {group.variants.map((variant) => (
                  <div key={variant.productName} style={{ display: 'flex', justifyContent: 'space-between', color: '#374151', fontSize: '0.9rem', padding: '0.15rem 0' }}>
                    <span>{variant.productName}</span>
                    <span>{variant.quantity} items · ৳{variant.subtotal.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}

        {sortedBaseGroups.length === 0 ? <p style={{ color: '#666' }}>No orders found for this range.</p> : null}
      </div>
    </main>
  );
}
