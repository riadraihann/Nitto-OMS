import { supabaseAdmin } from '@/lib/supabase';
import { parseSheetRow } from '@/lib/sheetRowParser.mjs';
import { diffOrderFields, summarizeItems } from '@/lib/orderHistory.mjs';
import { computeNeedsReview, reviewReasonsChanged } from '@/lib/orderValidation.mjs';
import { ATTEMPT_TYPES, isTerminalConfirmationStatus } from '@/lib/contactAttempts.mjs';

type HistoryEntry = { order_id: number; field: string; old_value: string | null; new_value: string | null; source: string };

// Sync passes can touch hundreds of orders, which is exactly what made "Sync Now" slow before
// (see scalarFieldsChanged/itemsChanged above) -- so history rows are collected in memory across
// the whole pass and written in one batched insert at the end, not one insert per order.
async function flushHistory(entries: HistoryEntry[]): Promise<void> {
  if (!supabaseAdmin || entries.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const { error } = await supabaseAdmin.from('order_history').insert(entries.slice(i, i + CHUNK));
    if (error) {
      console.error('order_history batch insert failed', error.message);
    }
  }
}

type ParsedAttempt = { type: string; count: number };

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
  parsedConfirmationStatus: string | null;
  parsedAttempts: ParsedAttempt[];
  columnCWarnings: string[];
  defaults: { urgency_type: string; confirmation_status: string; delivery_status: string };
};

type ExistingAttempt = { id: number; type: string; count: number; first_logged_at: string | null };

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
  needs_review: boolean;
  needs_review_reasons: string[] | null;
  order_items: { product_name: string; quantity: number }[];
  contact_attempts: ExistingAttempt[];
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
//    write-back in app/api/orders/route.ts and app/api/orders/attempts/route.ts). Only applied
//    here if the parsed value actually differs from what's already in the DB -- this is half of
//    loop prevention: our own write-back echoing back through the sheet must be a no-op, not
//    another DB write that triggers another write-back.
//  - contact_attempts (no_answer/unreachable/phone_off counters): reconciled from column C the
//    same way, but ONLY while the order is currently pending -- a terminal order's attempts are
//    already wiped and a sheet cell with no terminal marker yet (stale/lagging write-back) must
//    never be misread as "clear the attempts". If the sheet shows a terminal marker, that always
//    wins and wipes attempts regardless of the order's current state.
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
      .select('id, order_number, confirmation_status, urgency_type, urgency_target_date, customer_name, phone, address, total_amount, special_instructions, cancel_return_reason, created_at, order_source, sheet_row_number, needs_review, needs_review_reasons, order_items(product_name, quantity), contact_attempts(id, type, count, first_logged_at)')
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
  const historyEntries: HistoryEntry[] = [];

  for (const [orderNumber, parsed] of Array.from(parsedByOrderNumber.entries())) {
    const {
      items, defaults, sheetRowNumber,
      parsedUrgencyType, parsedUrgencyTargetDate, urgencyMalformed,
      parsedConfirmationStatus, parsedAttempts, columnCWarnings,
      ...sheetOwnedFields
    } = parsed;

    for (const message of columnCWarnings) {
      warnings.push({ order_number: orderNumber, message });
    }

    const existing = existingByOrderNumber.get(orderNumber);

    if (existing) {
      const update: Record<string, unknown> = {};
      let wipeAttempts = false;

      // confirmation: a terminal marker in the sheet always wins (and wipes attempts) if it
      // differs from the current status. No marker (null) means "no signal from the sheet" --
      // leave confirmation_status untouched either way.
      if (parsedConfirmationStatus && parsedConfirmationStatus !== existing.confirmation_status) {
        update.confirmation_status = parsedConfirmationStatus;
        wipeAttempts = true;
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

      let needsFieldUpdate = Object.keys(update).length > 0 || scalarFieldsChanged(sheetOwnedFields, sheetRowNumber, existing);
      const needsItemsUpdate = itemsChanged(items, existing.order_items);

      // needs_review is derived from phone/total_amount/item-count, all of which are covered by
      // needsFieldUpdate/needsItemsUpdate above -- so it only needs recomputing when something
      // already looks changed, never as an independent trigger for an otherwise-unchanged row
      if (needsFieldUpdate || needsItemsUpdate) {
        const proposedReview = computeNeedsReview(sheetOwnedFields as { phone?: string; total_amount?: number }, items);
        if (proposedReview.needs_review !== existing.needs_review || reviewReasonsChanged(proposedReview.needs_review_reasons, existing.needs_review_reasons)) {
          update.needs_review = proposedReview.needs_review;
          update.needs_review_reasons = proposedReview.needs_review_reasons;
          needsFieldUpdate = true;
        }
      }

      // contact_attempts: reconcile from the sheet's parsed attempt codes, but only while the
      // order is (and stays) pending -- if this pass is setting a terminal status, wipeAttempts
      // above already covers it; if the order was ALREADY terminal and the sheet shows no
      // terminal marker (a stale/lagging cell), attempts stay untouched rather than being
      // resurrected from a column C that hasn't caught up yet.
      const attemptOps: { action: 'insert' | 'update' | 'delete'; type: string; count: number; existingId?: number }[] = [];
      const orderStaysPending = !wipeAttempts && !isTerminalConfirmationStatus(update.confirmation_status as string ?? existing.confirmation_status);
      if (orderStaysPending) {
        for (const type of ATTEMPT_TYPES) {
          const parsedForType = parsedAttempts.find((a) => a.type === type);
          const parsedCount = parsedForType?.count ?? 0;
          const existingRow = existing.contact_attempts.find((a) => a.type === type);
          const existingCount = existingRow?.count ?? 0;

          if (parsedCount === existingCount) continue;

          if (parsedCount === 0 && existingRow) {
            attemptOps.push({ action: 'delete', type, count: 0, existingId: existingRow.id });
          } else if (existingRow) {
            attemptOps.push({ action: 'update', type, count: parsedCount, existingId: existingRow.id });
          } else {
            attemptOps.push({ action: 'insert', type, count: parsedCount });
          }

          historyEntries.push({ order_id: existing.id, field: type, old_value: existingCount > 0 ? String(existingCount) : null, new_value: parsedCount > 0 ? String(parsedCount) : null, source: 'sheet_sync' });
        }
      }
      const needsAttemptsUpdate = wipeAttempts ? existing.contact_attempts.length > 0 : attemptOps.length > 0;

      // the whole point: an unchanged row costs zero DB writes, not an update + a delete +
      // an insert every single sync pass -- that's what was making "Sync Now" take minutes
      if (!needsFieldUpdate && !needsItemsUpdate && !needsAttemptsUpdate) {
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

        // created_at is compared by parsed Date value elsewhere (scalarFieldsChanged) since the
        // sheet's format and the DB's stored ISO string differ even when logically identical --
        // excluded here from the plain string diff to avoid a false "changed" entry every pass.
        const changedFields = Object.keys(sheetOwnedFields).concat(Object.keys(update)).filter((field) => field !== 'created_at');
        for (const change of diffOrderFields(existing, { ...sheetOwnedFields, ...update }, changedFields)) {
          historyEntries.push({ order_id: existing.id, source: 'sheet_sync', ...change });
        }
        if (new Date(sheetOwnedFields.created_at as string).getTime() !== new Date(existing.created_at).getTime()) {
          historyEntries.push({ order_id: existing.id, field: 'created_at', old_value: existing.created_at, new_value: sheetOwnedFields.created_at as string, source: 'sheet_sync' });
        }
      }

      if (wipeAttempts && existing.contact_attempts.length > 0) {
        const { error: wipeError } = await supabaseAdmin.from('contact_attempts').delete().eq('order_id', existing.id);
        if (wipeError) {
          errors.push({ order_number: orderNumber, error: wipeError.message });
          continue;
        }
        const summary = existing.contact_attempts.map((a) => `${a.type}=${a.count}`).join(', ');
        historyEntries.push({ order_id: existing.id, field: 'contact_attempts', old_value: summary, new_value: null, source: 'sheet_sync' });
      } else if (attemptOps.length > 0) {
        for (const op of attemptOps) {
          if (op.action === 'delete') {
            const { error: deleteAttemptError } = await supabaseAdmin.from('contact_attempts').delete().eq('id', op.existingId);
            if (deleteAttemptError) { errors.push({ order_number: orderNumber, error: deleteAttemptError.message }); continue; }
          } else if (op.action === 'update') {
            const { error: updateAttemptError } = await supabaseAdmin.from('contact_attempts').update({ count: op.count, updated_at: nowIso }).eq('id', op.existingId);
            if (updateAttemptError) { errors.push({ order_number: orderNumber, error: updateAttemptError.message }); continue; }
          } else {
            const { error: insertAttemptError } = await supabaseAdmin.from('contact_attempts').insert([{ order_id: existing.id, type: op.type, count: op.count, first_logged_at: nowIso }]);
            if (insertAttemptError) { errors.push({ order_number: orderNumber, error: insertAttemptError.message }); continue; }
          }
        }
      }

      if (needsItemsUpdate) {
        const oldItemsSummary = summarizeItems(existing.order_items);
        const newItemsSummary = summarizeItems(items);

        const { error: deleteItemsError } = await supabaseAdmin.from('order_items').delete().eq('order_id', existing.id);
        if (deleteItemsError) {
          errors.push({ order_number: orderNumber, error: deleteItemsError.message });
          continue;
        }

        // a sheet row can now legitimately have zero items (flagged via needs_review rather
        // than dropped) -- skip the insert call entirely rather than call .insert([])
        if (items.length > 0) {
          const { error: insertItemsError } = await supabaseAdmin
            .from('order_items')
            .insert(items.map((item) => ({ order_id: existing.id, ...item })));
          if (insertItemsError) {
            errors.push({ order_number: orderNumber, error: insertItemsError.message });
            continue;
          }
        }

        if (oldItemsSummary !== newItemsSummary) {
          historyEntries.push({ order_id: existing.id, field: 'order_items', old_value: oldItemsSummary, new_value: newItemsSummary, source: 'sheet_sync' });
        }
      }

      updated += 1;
    } else {
      if (urgencyMalformed) {
        warnings.push({ order_number: orderNumber, message: 'urgency marker malformed on new order -- used the default instead' });
      }

      const newConfirmationStatus = parsedConfirmationStatus ?? defaults.confirmation_status;

      const insertRow = {
        ...sheetOwnedFields,
        confirmation_status: newConfirmationStatus,
        urgency_type: urgencyMalformed ? defaults.urgency_type : parsedUrgencyType,
        urgency_target_date: urgencyMalformed ? null : parsedUrgencyTargetDate,
        delivery_status: defaults.delivery_status,
        sheet_row_number: sheetRowNumber,
        synced_from_sheet_at: nowIso,
        ...computeNeedsReview(sheetOwnedFields as { phone?: string; total_amount?: number }, items),
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

      if (items.length > 0) {
        const { error: insertItemsError } = await supabaseAdmin
          .from('order_items')
          .insert(items.map((item) => ({ order_id: newOrder.id, ...item })));
        if (insertItemsError) {
          errors.push({ order_number: orderNumber, error: insertItemsError.message });
          continue;
        }
      }

      // a brand-new order can arrive with attempt codes already in column C -- only meaningful
      // if it landed in the pending state (a terminal marker on creation means no attempts, per
      // the wipe rule)
      if (!isTerminalConfirmationStatus(newConfirmationStatus) && parsedAttempts.length > 0) {
        const { error: insertAttemptsError } = await supabaseAdmin
          .from('contact_attempts')
          .insert(parsedAttempts.map((a) => ({ order_id: newOrder.id, type: a.type, count: a.count, first_logged_at: nowIso })));
        if (insertAttemptsError) {
          errors.push({ order_number: orderNumber, error: insertAttemptsError.message });
          continue;
        }
      }

      historyEntries.push({ order_id: newOrder.id, field: 'order_created', old_value: null, new_value: `Created via sheet sync (order_number ${orderNumber})`, source: 'sheet_sync' });

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
        for (const id of missingIds) {
          historyEntries.push({ order_id: id, field: 'removed_from_sheet_at', old_value: null, new_value: nowIso, source: 'sheet_sync' });
        }
      }
    }
  }

  await flushHistory(historyEntries);

  return {
    ok: true,
    status: 200,
    summary: { created, updated, unchanged, removed, skipped: skipped.length, warnings: warnings.length, errors: errors.length },
    skipped,
    warnings,
    errors,
  };
}
