import { supabaseAdmin } from '@/lib/supabase';
import { computeAttentionNeeded, type AttentionNeeded } from '@/lib/attentionChecks';
import { resolveFlagVisibility, applyReflaggedFlags, type ExistingFlag } from '@/lib/flagSuppression';

// Thin wrapper around computeAttentionNeeded that filters out resolved/ignored (order_id,
// flag_type) combinations. computeAttentionNeeded itself stays untouched -- suppression is a
// read-time filter layered on top, reusing the same resolveFlagVisibility used for needs_review.
export async function computeAttentionNeededWithFlags(staleDays: number): Promise<AttentionNeeded> {
  const raw = await computeAttentionNeeded(staleDays);
  const supabase = supabaseAdmin!;

  const rawByOrder = new Map<number, Set<string>>();
  const addRaw = (orderId: number, flagType: string) => {
    const set = rawByOrder.get(orderId) ?? new Set<string>();
    set.add(flagType);
    rawByOrder.set(orderId, set);
  };
  raw.subtotalMismatches.forEach((o) => addRaw(o.id, 'subtotal_mismatch'));
  raw.staleStatus.forEach((o) => addRaw(o.id, 'stale_status'));
  raw.urgencyPassed.forEach((o) => addRaw(o.id, 'urgency_passed'));
  // one flag row per member order, not per group -- ignoring one order in a pair doesn't affect
  // the other, and granularity is "check type per order" everywhere else too.
  raw.duplicateGroups.forEach((group) => group.orders.forEach((o) => addRaw(o.id, 'duplicate_group')));

  const orderIds = Array.from(rawByOrder.keys());
  if (orderIds.length === 0) return raw;

  const { data: flagRows, error } = await supabase
    .from('flags')
    .select('order_id, flag_type, status, acted_at, actor_name')
    .eq('source_system', 'attention_needed')
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
  const visibleByOrder = new Map<number, Set<string>>();
  for (const [orderId, rawSet] of Array.from(rawByOrder.entries())) {
    const existing = flagsByOrder.get(orderId) ?? [];
    const { visibleFlagTypes, reflagged } = resolveFlagVisibility(Array.from(rawSet), existing, now);
    visibleByOrder.set(orderId, new Set(visibleFlagTypes));
    if (reflagged.length > 0) {
      await applyReflaggedFlags(supabase, orderId, reflagged, existing);
    }
  }

  const isVisible = (orderId: number, flagType: string) => visibleByOrder.get(orderId)?.has(flagType) ?? false;

  const subtotalMismatches = raw.subtotalMismatches.filter((o) => isVisible(o.id, 'subtotal_mismatch'));
  const staleStatus = raw.staleStatus.filter((o) => isVisible(o.id, 'stale_status'));
  const urgencyPassed = raw.urgencyPassed.filter((o) => isVisible(o.id, 'urgency_passed'));
  // filtering happens at the member level, so a group can drop below 2 orders after suppression --
  // that's no longer a "duplicate" of anything, matching findDuplicates' own candidates.length<2 skip.
  const duplicateGroups = raw.duplicateGroups
    .map((group) => ({ ...group, orders: group.orders.filter((o) => isVisible(o.id, 'duplicate_group')) }))
    .filter((group) => group.orders.length >= 2);

  return { subtotalMismatches, staleStatus, urgencyPassed, duplicateGroups };
}
