import { supabaseAdmin } from '@/lib/supabase';
import { parseSheetRow } from '@/lib/sheetRowParser.mjs';

type ParsedRow = {
  order_number: string;
  created_at: string;
  order_source: string;
  customer_name: string;
  phone: string;
  address: string;
  special_instructions: string | null;
  cancel_return_reason: string | null;
  total_amount: number | null;
  items: { sku: string; product_name: string; quantity: number; unit_price: number }[];
  defaults: { urgency_status: string; confirmation_status: string; delivery_status: string };
};

export type ReconcileResult = {
  ok: boolean;
  status: number;
  error?: string;
  summary?: { created: number; updated: number; removed: number; skipped: number; errors: number };
  skipped?: { rowIndex: number; reason: string }[];
  errors?: { order_number: string; error: string }[];
};

// Shared by the push-based webhook (app/api/sync/sheet/route.ts) and the periodic backstop
// poll (app/api/sync/sheet/poll/route.ts) -- both just fetch the sheet's current rows by
// whatever means and hand them here.
//
// Reconciles the full current contents of the "Real Todays" sheet tab (always the whole tab,
// never a diff) against orders that were previously created/updated by this same sync
// (orders.synced_from_sheet_at is not null). CSV-imported and manually-entered orders are
// never matched or touched here, even if an order_number happens to collide.
//
// Field ownership on UPDATE: only sheet-sourced fields are overwritten (name/phone/address/notes/
// amount/items). urgency_status, confirmation_status, delivery_status, happiness_score and
// product_suggestions are staff-managed in the app and are left alone once an order exists.
export async function reconcileSheetRows(rows: unknown[]): Promise<ReconcileResult> {
  if (!supabaseAdmin) {
    return { ok: false, status: 500, error: 'Supabase admin client is not configured' };
  }

  // de-dupe by order_number within this payload -- if the sheet has two rows with the same
  // id (shouldn't happen, but the sheet isn't DB-constrained), the later row wins, matching
  // final on-screen sheet state
  const parsedByOrderNumber = new Map<string, ParsedRow>();
  const skipped: { rowIndex: number; reason: string }[] = [];

  rows.forEach((cols: unknown, rowIndex: number) => {
    const parsed = parseSheetRow(Array.isArray(cols) ? cols : []) as ParsedRow | { error: string };
    if ('error' in parsed) {
      skipped.push({ rowIndex, reason: parsed.error });
      return;
    }
    parsedByOrderNumber.set(parsed.order_number, parsed);
  });

  const orderNumbers = Array.from(parsedByOrderNumber.keys());

  if (rows.length > 0 && orderNumbers.length === 0) {
    // every row failed to parse -- almost certainly a garbled payload, not an empty sheet.
    // bail out rather than risk the removed-flag pass below treating this as "everything gone"
    return {
      ok: false,
      status: 400,
      error: 'No rows parsed successfully; rejecting payload rather than risk mass-flagging orders as removed',
      skipped,
    };
  }

  const existingByOrderNumber = new Map<string, number>();
  const LOOKUP_CHUNK = 300;
  for (let i = 0; i < orderNumbers.length; i += LOOKUP_CHUNK) {
    const chunk = orderNumbers.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_number')
      .in('order_number', chunk)
      .not('synced_from_sheet_at', 'is', null);

    if (error) {
      return { ok: false, status: 500, error: error.message };
    }
    for (const row of data ?? []) {
      existingByOrderNumber.set(row.order_number, row.id);
    }
  }

  let created = 0;
  let updated = 0;
  const errors: { order_number: string; error: string }[] = [];
  const nowIso = new Date().toISOString();

  for (const [orderNumber, parsed] of Array.from(parsedByOrderNumber.entries())) {
    const { items, defaults, ...sheetOwnedFields } = parsed;
    const existingId = existingByOrderNumber.get(orderNumber);

    if (existingId) {
      const { error: updateError } = await supabaseAdmin
        .from('orders')
        .update({ ...sheetOwnedFields, synced_from_sheet_at: nowIso, removed_from_sheet_at: null })
        .eq('id', existingId);

      if (updateError) {
        errors.push({ order_number: orderNumber, error: updateError.message });
        continue;
      }

      const { error: deleteItemsError } = await supabaseAdmin.from('order_items').delete().eq('order_id', existingId);
      if (deleteItemsError) {
        errors.push({ order_number: orderNumber, error: deleteItemsError.message });
        continue;
      }

      const { error: insertItemsError } = await supabaseAdmin
        .from('order_items')
        .insert(items.map((item) => ({ order_id: existingId, ...item })));
      if (insertItemsError) {
        errors.push({ order_number: orderNumber, error: insertItemsError.message });
        continue;
      }

      updated += 1;
    } else {
      const { data: newOrder, error: insertError } = await supabaseAdmin
        .from('orders')
        .insert([{ ...sheetOwnedFields, ...defaults, synced_from_sheet_at: nowIso }])
        .select('id')
        .single();

      if (insertError || !newOrder) {
        errors.push({ order_number: orderNumber, error: insertError?.message ?? 'insert failed' });
        continue;
      }

      const { error: insertItemsError } = await supabaseAdmin
        .from('order_items')
        .insert(items.map((item) => ({ order_id: newOrder.id, ...item })));
      if (insertItemsError) {
        errors.push({ order_number: orderNumber, error: insertItemsError.message });
        continue;
      }

      created += 1;
    }
  }

  let removed = 0;
  const { data: previouslySynced, error: syncedFetchError } = await supabaseAdmin
    .from('orders')
    .select('id, order_number')
    .not('synced_from_sheet_at', 'is', null)
    .is('removed_from_sheet_at', null);

  if (syncedFetchError) {
    errors.push({ order_number: '(removed-flag pass)', error: syncedFetchError.message });
  } else {
    const seenSet = new Set(orderNumbers);
    const missingIds = (previouslySynced ?? [])
      .filter((row) => !seenSet.has(row.order_number))
      .map((row) => row.id);

    if (missingIds.length > 0) {
      const { error: removeError } = await supabaseAdmin
        .from('orders')
        .update({ removed_from_sheet_at: nowIso })
        .in('id', missingIds);

      if (removeError) {
        errors.push({ order_number: '(removed-flag pass)', error: removeError.message });
      } else {
        removed = missingIds.length;
      }
    }
  }

  return {
    ok: true,
    status: 200,
    summary: { created, updated, removed, skipped: skipped.length, errors: errors.length },
    skipped,
    errors,
  };
}
