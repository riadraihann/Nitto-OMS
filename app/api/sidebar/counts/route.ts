import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVisibleNeedsReviewReasons } from '@/lib/needsReviewFlags';
import { computeAttentionNeededWithFlags } from '@/lib/attentionNeededWithFlags';
import { HISTORY_DELIVERY_STATUSES, CALL_PENDING_STAGES } from '@/lib/theme';

const DEFAULT_STALE_DAYS = 3;

// Backs every count badge in the sidebar (app/components/Sidebar.tsx). Each query here mirrors
// the base filter its corresponding page applies with no extra query params -- e.g. the "Orders"
// count matches exactly what GET /orders (no ?view=) renders -- so the sidebar number never
// disagrees with what clicking into the view actually shows.
export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  try {
    const [needsReviewOrders, attentionNeeded, cancelledCount, ordersCount, historyCount, callPendingCount] = await Promise.all([
      supabaseAdmin.from('orders').select('id, needs_review_reasons').eq('needs_review', true).is('archived_at', null),
      computeAttentionNeededWithFlags(DEFAULT_STALE_DAYS),
      // mirrors the /orders?view=cancelled filter exactly, so the sidebar count always matches
      // what that view actually shows
      supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('confirmation_status', 'cancelled')
        .is('archived_at', null)
        .not('delivery_status', 'in', `(${HISTORY_DELIVERY_STATUSES.join(',')})`),
      // mirrors GET /orders with no view/filter params: the active working queue
      supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null)
        .not('delivery_status', 'in', `(${HISTORY_DELIVERY_STATUSES.join(',')})`),
      // mirrors GET /history with no filter params: shipped orders (sent to courier or delivered)
      supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null)
        .in('delivery_status', HISTORY_DELIVERY_STATUSES),
      // mirrors /orders?view=call-pending exactly
      supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null)
        .not('delivery_status', 'in', `(${HISTORY_DELIVERY_STATUSES.join(',')})`)
        .eq('order_source', 'shopify')
        .in('confirmation_status', CALL_PENDING_STAGES),
    ]);

    const visibleReasonsByOrder = await getVisibleNeedsReviewReasons(supabaseAdmin, needsReviewOrders.data ?? []);
    const needsReviewCount = Array.from(visibleReasonsByOrder.values()).filter((reasons) => reasons.length > 0).length;

    const attentionNeededCount =
      attentionNeeded.subtotalMismatches.length +
      attentionNeeded.staleStatus.length +
      attentionNeeded.urgencyPassed.length +
      attentionNeeded.duplicateGroups.length;

    return NextResponse.json({
      ok: true,
      needsReview: needsReviewCount,
      attentionNeeded: attentionNeededCount,
      cancelled: cancelledCount.count ?? 0,
      orders: ordersCount.count ?? 0,
      history: historyCount.count ?? 0,
      callPending: callPendingCount.count ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
