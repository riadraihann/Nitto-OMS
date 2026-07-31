import { supabaseAdmin } from '@/lib/supabase';
import { TERMINAL_CONFIRMATION_STATUSES } from '@/lib/contactAttempts.mjs';

export type OrderRef = {
  id: number;
  order_number: string | null;
  customer_name: string;
  phone: string;
};

export type SubtotalMismatch = OrderRef & { total_amount: number; computed_subtotal: number };
export type StaleStatus = OrderRef & { confirmation_status: string; delivery_status: string; last_changed_at: string; days_since: number };
export type UrgencyPassed = OrderRef & { urgency_type: string; urgency_target_date: string; confirmation_status: string; delivery_status: string; days_overdue: number };
export type DuplicateGroup = { phone: string; day: string; orders: (OrderRef & { items: string[] })[] };

export type AttentionNeeded = {
  subtotalMismatches: SubtotalMismatch[];
  staleStatus: StaleStatus[];
  urgencyPassed: UrgencyPassed[];
  duplicateGroups: DuplicateGroup[];
};

// orders in these states are "done" and legitimately expected to never change again -- flagging
// them as stale would just be noise, not something anyone needs to act on. TERMINAL_CONFIRMATION_
// STATUSES (confirmed_c/wa/m, cancelled, hold) is the shared source of truth from
// lib/contactAttempts.mjs.
const RESOLVED_DELIVERY = ['delivered', 'returned'];

// how far back to look for possible duplicate orders -- unlike the other checks (which are
// naturally bounded to still-active orders), duplicate phone+day+items could technically match
// across the whole history, but a "duplicate" from 3 months ago isn't something to act on today
const DUPLICATE_LOOKBACK_DAYS = 30;

function dhakaDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000);
}

async function findSubtotalMismatches(nowIso: string): Promise<SubtotalMismatch[]> {
  const supabase = supabaseAdmin!;
  const mismatches: SubtotalMismatch[] = [];
  const PAGE = 1000;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, customer_name, phone, total_amount, order_items(quantity, unit_price)')
      .is('archived_at', null)
      .not('total_amount', 'is', null)
      .range(from, from + PAGE - 1);

    if (error) throw error;

    for (const order of (data ?? []) as any[]) {
      const items = order.order_items ?? [];
      const computedSubtotal = items.reduce((sum: number, item: any) => sum + Number(item.quantity) * Number(item.unit_price), 0);
      // sheet-sourced items always carry unit_price 0 (no per-item pricing in that source --
      // see the products-by-date report fix), so computedSubtotal === 0 means "no real
      // per-item pricing data," not "this order is free." Only compare when there's actually
      // something meaningful to compare against.
      if (computedSubtotal > 0 && Math.abs(computedSubtotal - Number(order.total_amount)) > 0.01) {
        mismatches.push({
          id: order.id,
          order_number: order.order_number,
          customer_name: order.customer_name,
          phone: order.phone,
          total_amount: Number(order.total_amount),
          computed_subtotal: computedSubtotal,
        });
      }
    }

    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  return mismatches;
}

async function findStaleStatus(staleDays: number, nowIso: string): Promise<StaleStatus[]> {
  const supabase = supabaseAdmin!;

  const { data: activeOrders, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_name, phone, confirmation_status, delivery_status, created_at')
    .is('archived_at', null)
    .not('confirmation_status', 'in', `(${TERMINAL_CONFIRMATION_STATUSES.join(',')})`)
    .not('delivery_status', 'in', `(${RESOLVED_DELIVERY.join(',')})`);

  if (error) throw error;
  if (!activeOrders || activeOrders.length === 0) return [];

  const lastChangedByOrderId = new Map<number, string>();
  const CHUNK = 300;
  for (let i = 0; i < activeOrders.length; i += CHUNK) {
    const ids = activeOrders.slice(i, i + CHUNK).map((o) => o.id);
    const { data: historyRows, error: historyError } = await supabase
      .from('order_history')
      .select('order_id, changed_at')
      .in('order_id', ids)
      .in('field', ['confirmation_status', 'delivery_status'])
      .order('changed_at', { ascending: false });

    if (historyError) throw historyError;
    for (const row of historyRows ?? []) {
      // sorted desc, so the first row seen per order_id is its most recent status change
      if (!lastChangedByOrderId.has(row.order_id)) {
        lastChangedByOrderId.set(row.order_id, row.changed_at);
      }
    }
  }

  const stale: StaleStatus[] = [];
  for (const order of activeOrders) {
    // no history entry at all -- either it's never been touched since creation, or it predates
    // Phase 1's audit trail. Either way, "since created" is the only honest reference point.
    const lastChangedAt = lastChangedByOrderId.get(order.id) ?? order.created_at;
    const daysSince = daysBetween(lastChangedAt, nowIso);
    if (daysSince >= staleDays) {
      stale.push({
        id: order.id,
        order_number: order.order_number,
        customer_name: order.customer_name,
        phone: order.phone,
        confirmation_status: order.confirmation_status,
        delivery_status: order.delivery_status,
        last_changed_at: lastChangedAt,
        days_since: daysSince,
      });
    }
  }

  return stale.sort((a, b) => b.days_since - a.days_since);
}

async function findUrgencyPassed(todayStr: string, nowIso: string): Promise<UrgencyPassed[]> {
  const supabase = supabaseAdmin!;

  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_name, phone, urgency_type, urgency_target_date, confirmation_status, delivery_status')
    .is('archived_at', null)
    .in('urgency_type', ['vu', 'd'])
    .lt('urgency_target_date', todayStr);

  if (error) throw error;

  const overdue: UrgencyPassed[] = [];
  for (const order of data ?? []) {
    // cancelled or on-hold orders were never going to ship on schedule -- the urgency deadline
    // is moot regardless of delivery_status, so either alone clears this flag (unlike the AND
    // below: a still-active, still-confirmed order needs BOTH "not cancelled/hold" and "not yet
    // delivered" to stay flagged -- a confirmed order still sitting in packaging past its
    // ship-by date is exactly what this check exists to catch)
    const stillNeedsAction = order.confirmation_status !== 'cancelled' && order.confirmation_status !== 'hold' && !RESOLVED_DELIVERY.includes(order.delivery_status);
    if (!stillNeedsAction) continue;
    overdue.push({
      id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      phone: order.phone,
      urgency_type: order.urgency_type,
      urgency_target_date: order.urgency_target_date,
      confirmation_status: order.confirmation_status,
      delivery_status: order.delivery_status,
      days_overdue: daysBetween(`${order.urgency_target_date}T00:00:00+06:00`, nowIso),
    });
  }

  return overdue.sort((a, b) => b.days_overdue - a.days_overdue);
}

async function findDuplicates(nowIso: string): Promise<DuplicateGroup[]> {
  const supabase = supabaseAdmin!;
  const sinceIso = new Date(new Date(nowIso).getTime() - DUPLICATE_LOOKBACK_DAYS * 86400000).toISOString();

  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_name, phone, created_at, order_items(product_name)')
    .is('archived_at', null)
    .neq('phone', '')
    .gte('created_at', sinceIso);

  if (error) throw error;

  type Candidate = OrderRef & { day: string; items: string[] };
  const groups = new Map<string, Candidate[]>();

  for (const order of (data ?? []) as any[]) {
    const day = dhakaDay(order.created_at);
    const key = `${order.phone}__${day}`;
    const candidate: Candidate = {
      id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      phone: order.phone,
      day,
      items: (order.order_items ?? []).map((item: any) => item.product_name),
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(candidate);
  }

  const duplicateGroups: DuplicateGroup[] = [];
  for (const [, candidates] of Array.from(groups.entries())) {
    if (candidates.length < 2) continue;

    // "similar items": flag the group if any product name is shared by at least two orders in
    // it. This is a coarse signal for a human to glance at, not an automated dedupe decision.
    const nameCounts = new Map<string, number>();
    for (const candidate of candidates) {
      for (const name of Array.from(new Set(candidate.items))) {
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      }
    }
    const hasSharedItem = Array.from(nameCounts.values()).some((count) => count >= 2);
    if (!hasSharedItem) continue;

    duplicateGroups.push({
      phone: candidates[0].phone,
      day: candidates[0].day,
      orders: candidates.map(({ day, ...rest }) => rest),
    });
  }

  return duplicateGroups;
}

export async function computeAttentionNeeded(staleDays: number): Promise<AttentionNeeded> {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client is not configured');
  }

  const nowIso = new Date().toISOString();
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowIso));

  const [subtotalMismatches, staleStatus, urgencyPassed, duplicateGroups] = await Promise.all([
    findSubtotalMismatches(nowIso),
    findStaleStatus(staleDays, nowIso),
    findUrgencyPassed(todayStr, nowIso),
    findDuplicates(nowIso),
  ]);

  return { subtotalMismatches, staleStatus, urgencyPassed, duplicateGroups };
}
