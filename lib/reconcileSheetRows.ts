import { supabaseAdmin } from '@/lib/supabase';
import { parseSheetRow } from '@/lib/sheetRowParser.mjs';

type ParsedRow = {
  order_number: string;
  created_at: string;
  order_source: string;
  customer_name: string;
  phone: string;
  address: string;
  total_amount: number | null;
  special_instructions: string | null;
  cancel_return_reason: string | null;
  items: { sku: string; product_name: string; quantity: number; unit_price: number }[];
  parsedUrgencyType: string;
  parsedUrgencyTargetDate: string | null;
  urgencyMalformed: boolean;
  parsedConfirmationStatus: string;
  columnCWarnings: string[];
  defaults: { urgency_type: string; delivery_status: string };
};

type ExistingOrder = {
  id: number;
  confirmation_status: string;
  urgency_type: string;
  urgency_target_date: string | null;
  customer_name: string;
  phone: string;
  address: string;
  total_amount: number | null;
  special_instructions: string | null;
  cancel_return_reason: string | null;
  created_at: string;
  order_source: string;
  sheet_row_number: number | null;
  order_items: { product_name: string; quantity: number }[];
};

export type ReconcileResult = {
  ok: boolean;
  status: number;
  error?: string;
  summary?: { created: number; updated: number; unchanged: number; removed: number; skipped: number; warnings: number; errors: number };
  skipped?: { rowIndex: number; reason: string }[];
  warnings?: { order_number: string; message: string }[];
  errors?: { order_number: string; error: string }[];
};

function dayOfMonth(dateStr: string | null): number | null {
  return dateStr ? new Date(dateStr).getUTCDate() : null;
}

function scalarFieldsChanged(sheetOwnedFields: Record<string, unknown>, sheetRowNumber: number, existing: ExistingOrder): boolean {
  return (
    sheetOwnedFields.customer_name !== existing.customer_name ||
    sheetOwnedFields.phone !== existing.phone ||
    sheetOwnedFields.address !== existing.address ||
    sheetOwnedFields.total_amount !== existing.total_amount ||
    sheetOwnedFields.special_instructions !== existing.special_instructions ||
    sheetOwnedFields.cancel_return_reason !== existing.cancel_return_reason ||
    sheetOwnedFields.order_source !== existing.order_source ||
    sheetRowNumber !== existing.sheet_row_number ||
    new Date(sheetOwnedFields.created_at as string).getTime() !== new Date(existing.created_at).getTime()
  );
}

function itemsChanged(parsedItems: { product_name: string; quantity: number }[], existingItems: ExistingOrder['order_items']): boolean {
  if (parsedItems.length !== existingItems.length) return true;
  const normalize = (items: { product_name: string; quantity: number }[]) =>
    items.map((item) => `${item.product_name}::${item.quantity}`).sort();
  const a = normalize(parsedItems);
  const b = normalize(existingItems);
  return a.some((value, index) => value !== b[index]);
}

// Shared by the push-based webhook (app/api/sync/sheet/route.ts), the periodic backstop poll,
// and the on-demand "Sync Now" button -- all three just fetch the sheet's current rows by
// whatever means and hand them here.
//
// Reconciles the full current contents of the "Real Todays Orders" sheet tab (always the whole
// tab, never a diff) against orders that were previously created/updated by this same sync
// (orders.synced_from_sheet_at is not null). CSV-imported and manually-entered orders are
// never matched or touched here, even if an order_number happens to collide.
//
// Field ownership on UPDATE:
//  - name/phone/address/amount/items/created_at/order_source: always sheet-owned, overwritten
//    every pass.
//  - confirmation_status and urgency_type/urgency_target_date: bidirectionally synced via
//    column C (see lib/sheetRowParser.mjs's parseColumnC/buildColumnC and the app -> sheet
//    write-back in app/api/orders/route.ts). Only applied here if the parsed value actually
//    differs from what's already in the DB -- this is half of loop prevention: our own
//    write-back echoing back through the sheet must be a no-op, not another DB write that
//    triggers another write-back.
//  - delivery_status, happiness_score, product_suggestions: still purely staff-managed in the
//    app, never touched by sheet sync.
export async function reconcileSheetRows(rows: unknown[]): Promise<ReconcileResult> {
  if (!supabaseAdmin) {
    return { ok: false, status: 500, error: 'Supabase admin client is not configured' };
  }

  // de-dupe by order_number within this payload -- if the sheet has two rows with the same
  // id (shouldn't happen, but the sheet isn't DB-constrained), the later row wins, matching
  // final on-screen sheet state
  const parsedByOrderNumber = new Map<string, ParsedRow & { sheetRowNumber: number }>();
  const skipped: { rowIndex: number; reason: string }[] = [];
  const warnings: { order_number: string; message: string }[] = [];

  rows.forEach((cols: unknown, rowIndex: number) => {
    const parsed = parseSheetRow(Array.isArray(cols) ? cols : []) as ParsedRow | { error: string };
    if ('error' in parsed) {
      skipped.push({ rowIndex, reason: parsed.error });
      return;
    }
    parsedByOrderNumber.set(parsed.order_number, { ...parsed, sheetRowNumber: rowIndex + 1 });
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

  const existingByOrderNumber = new Map<string, ExistingOrder>();
  const LOOKUP_CHUNK = 300;
  for (let i = 0; i < orderNumbers.length; i += LOOKUP_CHUNK) {
    const chunk = orderNumbers.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, confirmation_status, urgency_type, urgency_target_date, customer_name, phone, address, total_amount, special_instructions, cancel_return_reason, created_at, order_source, sheet_row_number, order_items(product_name, quantity)')
      .in('order_number', chunk)
      .not('synced_from_sheet_at', 'is', null);

    if (error) {
      return { ok: false, status: 500, error: error.message };
    }
    for (const row of data ?? []) {
      existingByOrderNumber.set(row.order_number, row);
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const errors: { order_number: string; error: string }[] = [];
  const nowIso = new Date().toISOString();

  for (const [orderNumber, parsed] of Array.from(parsedByOrderNumber.entries())) {
    const {
      items, defaults, sheetRowNumber,
      parsedUrgencyType, parsedUrgencyTargetDate, urgencyMalformed,
      parsedConfirmationStatus, columnCWarnings,
      ...sheetOwnedFields
    } = parsed;

    for (const message of columnCWarnings) {
      warnings.push({ order_number: orderNumber, message });
    }

    const existing = existingByOrderNumber.get(orderNumber);

    if (existing) {
      const update: Record<string, unknown> = {};

      // confirmation: apply only if it actually differs (loop prevention) -- parseColumnC
      // always resolves to a definite status (defaulting to 'pending' if no marker is found),
      // so there's no "unrecognized, leave alone" case for this piece specifically
      if (parsedConfirmationStatus !== existing.confirmation_status) {
        update.confirmation_status = parsedConfirmationStatus;
      }

      // urgency: apply only if parsed cleanly AND actually differs (compare by day-of-month,
      // since that's the marker's actual granularity, not the full stored date)
      if (urgencyMalformed) {
        warnings.push({ order_number: orderNumber, message: 'urgency marker malformed -- left unchanged' });
      } else {
        const parsedDay = dayOfMonth(parsedUrgencyTargetDate);
        const existingDay = dayOfMonth(existing.urgency_target_date);
        const changed = parsedUrgencyType !== existing.urgency_type || parsedDay !== existingDay;
        if (changed) {
          update.urgency_type = parsedUrgencyType;
          update.urgency_target_date = parsedUrgencyTargetDate;
        }
      }

      const needsFieldUpdate = Object.keys(update).length > 0 || scalarFieldsChanged(sheetOwnedFields, sheetRowNumber, existing);
      const needsItemsUpdate = itemsChanged(items, existing.order_items);

      // the whole point: an unchanged row costs zero DB writes, not an update + a delete +
      // an insert every single sync pass -- that's what was making "Sync Now" take minutes
      if (!needsFieldUpdate && !needsItemsUpdate) {
        unchanged += 1;
        continue;
      }

      if (needsFieldUpdate) {
        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update({ ...sheetOwnedFields, ...update, sheet_row_number: sheetRowNumber, synced_from_sheet_at: nowIso, removed_from_sheet_at: null })
          .eq('id', existing.id);

        if (updateError) {
          errors.push({ order_number: orderNumber, error: updateError.message });
          continue;
        }
      }

      if (needsItemsUpdate) {
        const { error: deleteItemsError } = await supabaseAdmin.from('order_items').delete().eq('order_id', existing.id);
        if (deleteItemsError) {
          errors.push({ order_number: orderNumber, error: deleteItemsError.message });
          continue;
        }

        const { error: insertItemsError } = await supabaseAdmin
          .from('order_items')
          .insert(items.map((item) => ({ order_id: existing.id, ...item })));
        if (insertItemsError) {
          errors.push({ order_number: orderNumber, error: insertItemsError.message });
          continue;
        }
      }

      updated += 1;
    } else {
      if (urgencyMalformed) {
        warnings.push({ order_number: orderNumber, message: 'urgency marker malformed on new order -- used the default instead' });
      }

      const insertRow = {
        ...sheetOwnedFields,
        confirmation_status: parsedConfirmationStatus,
        urgency_type: urgencyMalformed ? defaults.urgency_type : parsedUrgencyType,
        urgency_target_date: urgencyMalformed ? null : parsedUrgencyTargetDate,
        delivery_status: defaults.delivery_status,
        sheet_row_number: sheetRowNumber,
        synced_from_sheet_at: nowIso,
      };

      const { data: newOrder, error: insertError } = await supabaseAdmin
        .from('orders')
        .insert([insertRow])
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
    summary: { created, updated, unchanged, removed, skipped: skipped.length, warnings: warnings.length, errors: errors.length },
    skipped,
    warnings,
    errors,
  };
}
