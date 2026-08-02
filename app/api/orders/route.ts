import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getActor } from '@/lib/supabase/server';
import { normalizeUrgencyFields } from '@/lib/urgencyTarget.mjs';
import { buildColumnC } from '@/lib/sheetRowParser.mjs';
import { writeColumnC } from '@/lib/sheetWriteBack';
import { diffOrderFields, logOrderHistory } from '@/lib/orderHistory.mjs';
import { computeNeedsReview, validateFeedbackFields } from '@/lib/orderValidation.mjs';
import { isTerminalConfirmationStatus } from '@/lib/contactAttempts.mjs';
import { getVisibleNeedsReviewReasons } from '@/lib/needsReviewFlags';
import { cancelOnShopify } from '@/lib/shopifyAdmin';

// Fields whose values feed computeNeedsReview -- a PATCH only needs to recompute needs_review
// when one of these actually changed (item count can't change via this endpoint at all, so it's
// not in this list; see reconcileSheetRows.ts for where item-driven recompute happens).
const REVIEW_RELEVANT_FIELDS = ['phone', 'total_amount'];

// normalizeUrgencyFields always resolves urgency_type changes down to these two keys (plus
// confirmation_status passes through untouched) -- checking for these after normalization is
// enough to know whether this PATCH touched anything column-C-relevant
const SHEET_SYNCED_FIELDS = ['confirmation_status', 'urgency_type'];

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    const query = id
      ? supabaseAdmin.from('orders').select('*, order_items(*), contact_attempts(type, count, first_logged_at)').eq('id', id).single()
      : supabaseAdmin.from('orders').select('*, order_items(*), contact_attempts(type, count, first_logged_at)').order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (id && data) {
      const visibleReasonsByOrder = await getVisibleNeedsReviewReasons(supabaseAdmin, [data]);
      (data as any).visible_needs_review_reasons = visibleReasonsByOrder.get((data as any).id) ?? [];
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  try {
    const payload = await request.json();
    const { items = [], ...rawOrderData } = payload as { items?: Array<Record<string, unknown>>; [key: string]: unknown };

    const normalized = normalizeUrgencyFields(rawOrderData);
    if (!normalized.ok) {
      return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
    }
    const orderData = normalized.payload;

    const feedbackValidation = validateFeedbackFields(orderData);
    if (!feedbackValidation.ok) {
      return NextResponse.json({ ok: false, error: feedbackValidation.error }, { status: 400 });
    }

    const normalizedItems = (items as Array<Record<string, unknown>>)
      .filter((item) => Boolean(item?.sku || item?.product_name))
      .map((item) => ({
        sku: String(item.sku ?? ''),
        product_name: String(item.product_name ?? ''),
        quantity: Number(item.quantity ?? 1),
        unit_price: Number(item.unit_price ?? 0),
      }));

    const review = computeNeedsReview(orderData as { phone?: string; total_amount?: number }, normalizedItems);

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert([{ ...orderData, ...review }])
      .select()
      .single();

    if (orderError || !order) {
      return NextResponse.json({ ok: false, error: orderError?.message ?? 'Unable to create order' }, { status: 500 });
    }

    if (normalizedItems.length > 0) {
      const { error: itemsError } = await supabaseAdmin
        .from('order_items')
        .insert(normalizedItems.map((item) => ({ order_id: order.id, ...item })));

      if (itemsError) {
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 });
      }
    }

    const actor = await getActor();
    await logOrderHistory(
      supabaseAdmin,
      order.id,
      [{ field: 'order_created', old_value: null, new_value: `Created manually (${order.order_source})` }],
      'moderator',
      actor?.name ?? null,
    );

    return NextResponse.json({ ok: true, data: { order, items: normalizedItems } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  try {
    const payload = await request.json();
    const id = payload?.id;

    if (!id) {
      return NextResponse.json({ ok: false, error: 'Order id is required' }, { status: 400 });
    }

    const rawUpdatePayload = { ...payload };
    delete rawUpdatePayload.id;
    // Not a real order column -- pulled out here so it never reaches normalizeUrgencyFields/the
    // update() call below, and handled separately after the app-side cancellation has committed.
    const cancelOnShopifyRequested = Boolean(rawUpdatePayload.cancel_on_shopify);
    delete rawUpdatePayload.cancel_on_shopify;

    const normalized = normalizeUrgencyFields(rawUpdatePayload);
    if (!normalized.ok) {
      return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
    }

    const feedbackValidation = validateFeedbackFields(normalized.payload);
    if (!feedbackValidation.ok) {
      return NextResponse.json({ ok: false, error: feedbackValidation.error }, { status: 400 });
    }

    // phone/total_amount are sheet/CSV-owned and not edited through the UI today, but PATCH is a
    // generic endpoint -- recompute needs_review whenever a review-relevant field is actually
    // touched, so a direct API call (or a future UI for these fields) can't silently desync the flag
    if (REVIEW_RELEVANT_FIELDS.some((field) => field in normalized.payload)) {
      const [{ data: currentOrder }, { data: currentItems }] = await Promise.all([
        supabaseAdmin.from('orders').select('phone, total_amount').eq('id', id).single(),
        supabaseAdmin.from('order_items').select('quantity, unit_price').eq('order_id', id),
      ]);
      const merged = { ...currentOrder, ...normalized.payload };
      Object.assign(normalized.payload, computeNeedsReview(merged as { phone?: string; total_amount?: number }, currentItems ?? []));
    }

    // First transition to 'sent_to_courier'/'delivered' stamps the real dispatch date -- see
    // supabase/add_dispatch_dates.sql. Only set once: re-selecting the same status later (e.g.
    // after a moderator corrects a mistaken delivery_status back and forth) must not overwrite
    // the original event time.
    if ('delivery_status' in normalized.payload) {
      const { data: currentDates } = await supabaseAdmin.from('orders').select('courier_handoff_date, delivered_date').eq('id', id).single();
      const nowIso = new Date().toISOString();
      if (normalized.payload.delivery_status === 'sent_to_courier' && !currentDates?.courier_handoff_date) {
        normalized.payload.courier_handoff_date = nowIso;
      }
      if (normalized.payload.delivery_status === 'delivered' && !currentDates?.delivered_date) {
        normalized.payload.delivered_date = nowIso;
      }
    }

    const updatedFields = Object.keys(normalized.payload);
    const { data: before, error: beforeError } = await supabaseAdmin
      .from('orders')
      .select(updatedFields.join(','))
      .eq('id', id)
      .single();

    if (beforeError) {
      return NextResponse.json({ ok: false, error: beforeError.message }, { status: 500 });
    }

    const { data, error } = await supabaseAdmin.from('orders').update(normalized.payload).eq('id', id).select().single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const actor = await getActor();
    const changes = diffOrderFields(before, data, updatedFields);
    await logOrderHistory(supabaseAdmin, id, changes, 'moderator', actor?.name ?? null);

    // moving to a terminal confirmation status wipes all contact-attempt counters -- the
    // display becomes just that status, not the attempt history alongside it
    if ('confirmation_status' in normalized.payload && isTerminalConfirmationStatus(normalized.payload.confirmation_status as string)) {
      const { data: existingAttempts } = await supabaseAdmin.from('contact_attempts').select('type, count').eq('order_id', id);
      if (existingAttempts && existingAttempts.length > 0) {
        await supabaseAdmin.from('contact_attempts').delete().eq('order_id', id);
        const summary = existingAttempts.map((a) => `${a.type}=${a.count}`).join(', ');
        await logOrderHistory(supabaseAdmin, id, [{ field: 'contact_attempts', old_value: summary, new_value: null }], 'moderator', actor?.name ?? null);
      }
    }

    let sheetSyncWarning: string | undefined;
    const touchedSheetSyncedField = Object.keys(normalized.payload).some((key) => SHEET_SYNCED_FIELDS.includes(key));

    // write-back only applies to orders that actually came from the sheet sync -- an order
    // created manually or via the June CSV import has no matching sheet row to write into
    if (touchedSheetSyncedField && data.synced_from_sheet_at && data.sheet_row_number) {
      const { data: attemptRows } = await supabaseAdmin.from('contact_attempts').select('type, count, first_logged_at').eq('order_id', id);
      const columnCValue = buildColumnC(data.urgency_type, data.urgency_target_date, data.confirmation_status, attemptRows ?? []);
      const writeResult = await writeColumnC(data.sheet_row_number, columnCValue);
      if (!writeResult.ok) {
        sheetSyncWarning = `Saved, but couldn't write back to the sheet: ${writeResult.error}`;
      }
    }

    // Only attempted once the app-side cancellation above has already succeeded -- a Shopify-side
    // failure is surfaced as a warning, never as a reason to fail this request or roll anything back.
    let shopifyWarning: string | undefined;
    if (cancelOnShopifyRequested && normalized.payload.confirmation_status === 'cancelled' && data.order_source === 'shopify') {
      const shopifyResult = await cancelOnShopify(supabaseAdmin, data, actor?.name ?? null);
      if (!shopifyResult.ok) {
        shopifyWarning = `Cancelled here, but Shopify wasn't updated: ${shopifyResult.error}`;
      }
    }

    return NextResponse.json({ ok: true, data, ...(sheetSyncWarning ? { sheetSyncWarning } : {}), ...(shopifyWarning ? { shopifyWarning } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
