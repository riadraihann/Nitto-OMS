import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { dhakaDayBounds, todayDhakaBounds, recentDhakaDays, dhakaDayString } from '@/lib/dhakaTime.mjs';
import { baseProductName } from '@/lib/productGrouping.mjs';
import { DASHBOARD_TRACKED_PRODUCTS } from '@/lib/dashboardProducts';

const CONFIRMED_STATUSES = ['confirmed_c', 'confirmed_wa', 'confirmed_m'];

export type TodayStats = {
  ordersToday: number;
  itemsToday: number;
  confirmedToday: { social: number; shopify: number; total: number };
  cancelledToday: number;
  yetToConfirmToday: number;
};

export type TrendPoint = { day: string; value: number };

export type DashboardTrends = {
  days: string[];
  overall: TrendPoint[];
  products: { key: string; label: string; trend: TrendPoint[] }[];
};

// Today's stats read the cohort of orders *created* today and break it down by current status --
// "of what came in today, how much is confirmed/cancelled/still being worked." All bounds are
// GMT+6 (Asia/Dhaka) calendar-day boundaries, per lib/dhakaTime.mjs.
async function computeTodayStatsUncached(): Promise<TodayStats> {
  const supabase = supabaseAdmin!;
  const { startIso, endIso } = todayDhakaBounds();

  const { data: todaysOrders, error } = await supabase
    .from('orders')
    .select('id, order_source, confirmation_status')
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (error) throw error;

  const orders = todaysOrders ?? [];
  const ordersToday = orders.length;

  let itemsToday = 0;
  if (orders.length > 0) {
    const items = await orderItemsForOrderIds(orders.map((o) => o.id));
    itemsToday = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  }

  let social = 0;
  let shopify = 0;
  let confirmedTotal = 0;
  let cancelledToday = 0;
  let yetToConfirmToday = 0;

  for (const order of orders) {
    if (CONFIRMED_STATUSES.includes(order.confirmation_status)) {
      confirmedTotal += 1;
      if (order.order_source === 'social') social += 1;
      if (order.order_source === 'shopify') shopify += 1;
    } else if (order.confirmation_status === 'cancelled') {
      cancelledToday += 1;
    } else if (order.confirmation_status === 'pending') {
      // 'pending' is the single non-terminal confirmation_status; whether or not it has
      // active contact_attempts logged (x1/x2/x3/unreachable/phone_off) is orthogonal to this
      // count -- both "never called yet" and "mid-attempts" are still "yet to confirm."
      yetToConfirmToday += 1;
    }
  }

  return {
    ordersToday,
    itemsToday,
    confirmedToday: { social, shopify, total: confirmedTotal },
    cancelledToday,
    yetToConfirmToday,
  };
}

// One pass over the last `days` Dhaka calendar days' orders (+ their line items) produces both
// the overall per-day order count and every tracked product's per-day quantity -- adding a
// product to DASHBOARD_TRACKED_PRODUCTS costs no extra query, just one more accumulator map.
async function computeDashboardTrendsUncached(days = 30): Promise<DashboardTrends> {
  const dayList = recentDhakaDays(days);
  const rangeStart = dhakaDayBounds(dayList[0]).startIso;
  const rangeEnd = todayDhakaBounds().endIso;

  const orders = await ordersInRange(rangeStart, rangeEnd);
  const dayByOrderId = new Map(orders.map((o) => [o.id, dhakaDayString(o.created_at)]));

  const overallCounts = new Map(dayList.map((d) => [d, 0]));
  for (const order of orders) {
    const day = dayByOrderId.get(order.id)!;
    overallCounts.set(day, (overallCounts.get(day) ?? 0) + 1);
  }

  const productCounts = new Map(DASHBOARD_TRACKED_PRODUCTS.map((p) => [p.key, new Map(dayList.map((d) => [d, 0]))]));

  if (orders.length > 0) {
    const items = await orderItemsForOrderIds(orders.map((o) => o.id));
    for (const item of items) {
      const day = dayByOrderId.get(item.order_id);
      if (!day) continue;
      const base = baseProductName(item.product_name);
      for (const product of DASHBOARD_TRACKED_PRODUCTS) {
        if (product.base === base) {
          const map = productCounts.get(product.key)!;
          map.set(day, (map.get(day) ?? 0) + Number(item.quantity));
        }
      }
    }
  }

  return {
    days: dayList,
    overall: dayList.map((day) => ({ day, value: overallCounts.get(day) ?? 0 })),
    products: DASHBOARD_TRACKED_PRODUCTS.map((p) => ({
      key: p.key,
      label: p.label,
      trend: dayList.map((day) => ({ day, value: productCounts.get(p.key)!.get(day) ?? 0 })),
    })),
  };
}

// The root layout reads the auth cookie on every request (see lib/supabase/server.ts), which
// forces the whole app -- including this page -- into dynamic (per-request) rendering. That
// means a page-level `export const revalidate` would be a no-op here: Next only honors it for
// routes it can fully static-cache. unstable_cache instead caches these two data-fetching
// functions' *results* directly, independent of how the page around them renders, so the
// underlying Supabase aggregation actually only runs once per 60s across every viewer -- not
// real-time, but not recomputed per page load either, per the brief's ask to weigh that tradeoff.
export const computeTodayStats = unstable_cache(computeTodayStatsUncached, ['dashboard-today-stats'], { revalidate: 60 });
export const computeDashboardTrends = unstable_cache(computeDashboardTrendsUncached, ['dashboard-trends'], { revalidate: 60 });

// Paginated range scan on the indexed created_at column -- bounded to the requested window
// (e.g. last 30 days), so this stays fast regardless of how large the orders table grows
// overall; only the visible window's row count matters here.
async function ordersInRange(rangeStart: string, rangeEnd: string): Promise<{ id: number; created_at: string }[]> {
  const supabase = supabaseAdmin!;
  const PAGE = 1000;
  let all: { id: number; created_at: string }[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, created_at')
      .gte('created_at', rangeStart)
      .lt('created_at', rangeEnd)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  return all;
}

// Chunked .in() lookup (PostgREST/URL length limits) -- same pattern as
// lib/attentionChecks.ts's findStaleStatus.
async function orderItemsForOrderIds(orderIds: number[]): Promise<{ order_id: number; product_name: string; quantity: number }[]> {
  const supabase = supabaseAdmin!;
  const CHUNK = 300;
  const items: { order_id: number; product_name: string; quantity: number }[] = [];

  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const { data, error } = await supabase.from('order_items').select('order_id, product_name, quantity').in('order_id', chunk);
    if (error) throw error;
    items.push(...((data ?? []) as { order_id: number; product_name: string; quantity: number }[]));
  }

  return items;
}
