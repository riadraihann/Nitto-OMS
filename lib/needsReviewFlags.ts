import { resolveFlagVisibility, applyReflaggedFlags, type ExistingFlag } from '@/lib/flagSuppression';

type OrderWithReasons = {
  id: number;
  needs_review_reasons: string[] | null;
};

// Fetches this batch of orders' needs_review flags rows, filters each order's raw reasons
// through resolveFlagVisibility, and returns a map of order_id -> visible reason codes. Also
// fires the reflag side effect (delete stale resolved row + history log) for any that came back.
export async function getVisibleNeedsReviewReasons(supabaseClient: any, orders: OrderWithReasons[]): Promise<Map<number, string[]>> {
  const orderIds = orders.filter((o) => o.needs_review_reasons && o.needs_review_reasons.length > 0).map((o) => o.id);
  const result = new Map<number, string[]>();
  if (orderIds.length === 0) return result;

  const { data: flagRows, error } = await supabaseClient
    .from('flags')
    .select('order_id, flag_type, status, acted_at, actor_name')
    .eq('source_system', 'needs_review')
    .in('order_id', orderIds);

  const flagsByOrder = new Map<number, ExistingFlag[]>();
  if (!error) {
    for (const row of flagRows ?? []) {
      const list = flagsByOrder.get(row.order_id) ?? [];
      list.push({ flag_type: row.flag_type, status: row.status, acted_at: row.acted_at, actor_name: row.actor_name });
      flagsByOrder.set(row.order_id, list);
    }
  }

  const now = new Date();
  for (const order of orders) {
    const rawReasons = order.needs_review_reasons ?? [];
    if (rawReasons.length === 0) {
      result.set(order.id, []);
      continue;
    }
    const existing = flagsByOrder.get(order.id) ?? [];
    const { visibleFlagTypes, reflagged } = resolveFlagVisibility(rawReasons, existing, now);
    result.set(order.id, visibleFlagTypes);
    if (reflagged.length > 0) {
      await applyReflaggedFlags(supabaseClient, order.id, reflagged, existing);
    }
  }

  return result;
}
