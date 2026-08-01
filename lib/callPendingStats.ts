import { supabaseAdmin } from '@/lib/supabase';
import { HISTORY_DELIVERY_STATUSES, CALL_PENDING_STAGES } from '@/lib/theme';
import { ATTEMPT_TYPES } from '@/lib/contactAttempts.mjs';
import { todayDhakaBounds } from '@/lib/dhakaTime.mjs';

// A change to one of these confirmation_status values today is what makes an order count
// toward today's confirmation-rate denominator -- deliberately narrower than
// TERMINAL_CONFIRMATION_STATUSES (which also includes 'hold'): moving an order to hold isn't a
// call outcome for the day, so it shouldn't count as "activity" either way.
const CONFIRMED_OR_CANCELLED = ['confirmed_c', 'confirmed_wa', 'confirmed_m', 'cancelled'];
const CONFIRMED_ONLY = ['confirmed_c', 'confirmed_wa', 'confirmed_m'];

export type CallPendingStats = {
  totalCallPending: number;
  activeAttempts: number;
  fullyPending: number;
  confirmationRate: { numerator: number; denominator: number };
};

// Backs the three header stats on /orders?view=call-pending (see app/orders/page.tsx).
export async function computeCallPendingStats(): Promise<CallPendingStats> {
  const supabase = supabaseAdmin!;

  // Scope mirrors the /orders?view=call-pending query exactly, so "active attempts" +
  // "fully pending" always add up to the same total the list itself shows.
  const { data: callPendingOrders, error: cpError } = await supabase
    .from('orders')
    .select('id')
    .is('archived_at', null)
    .not('delivery_status', 'in', `(${HISTORY_DELIVERY_STATUSES.join(',')})`)
    .eq('order_source', 'shopify')
    .in('confirmation_status', CALL_PENDING_STAGES);

  if (cpError) throw cpError;
  const callPendingIds = (callPendingOrders ?? []).map((o) => o.id as number);

  let activeAttempts = 0;
  if (callPendingIds.length > 0) {
    const { data: attemptRows, error: attemptsError } = await supabase
      .from('contact_attempts')
      .select('order_id')
      .in('order_id', callPendingIds)
      .gt('count', 0);
    if (attemptsError) throw attemptsError;
    activeAttempts = new Set((attemptRows ?? []).map((r) => r.order_id as number)).size;
  }

  const fullyPending = callPendingIds.length - activeAttempts;

  // Today's confirmation rate is independent of the call-pending scope above -- an order
  // confirmed or cancelled today has already left this view, but still counts toward the rate.
  const { startIso, endIso } = todayDhakaBounds();

  const { data: historyRows, error: historyError } = await supabase
    .from('order_history')
    .select('order_id, field, new_value')
    .gte('changed_at', startIso)
    .lt('changed_at', endIso)
    .in('field', [...ATTEMPT_TYPES, 'confirmation_status']);
  if (historyError) throw historyError;

  const denominatorIds = new Set<number>();
  for (const row of historyRows ?? []) {
    if ((ATTEMPT_TYPES as string[]).includes(row.field)) {
      denominatorIds.add(row.order_id as number);
    } else if (row.field === 'confirmation_status' && row.new_value && CONFIRMED_OR_CANCELLED.includes(row.new_value)) {
      denominatorIds.add(row.order_id as number);
    }
  }

  let numerator = 0;
  if (denominatorIds.size > 0) {
    const { count, error: confirmedError } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('id', Array.from(denominatorIds))
      .in('confirmation_status', CONFIRMED_ONLY);
    if (confirmedError) throw confirmedError;
    numerator = count ?? 0;
  }

  return {
    totalCallPending: callPendingIds.length,
    activeAttempts,
    fullyPending,
    confirmationRate: { numerator, denominator: denominatorIds.size },
  };
}
