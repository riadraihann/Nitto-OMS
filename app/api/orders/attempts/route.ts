import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getActor } from '@/lib/supabase/server';
import { ATTEMPT_TYPES, ATTEMPT_MAX, isTerminalConfirmationStatus } from '@/lib/contactAttempts.mjs';
import { buildColumnC } from '@/lib/sheetRowParser.mjs';
import { writeColumnC } from '@/lib/sheetWriteBack';
import { logOrderHistory } from '@/lib/orderHistory.mjs';

// Logs one contact attempt of a given type against an order, incrementing that type's own
// counter (never creating a second row for the same type -- see lib/contactAttempts.mjs for the
// full replace-within-type/stack-across-types model). Refuses once that type is capped, or if
// the order is already at a terminal confirmation status (attempts don't mean anything there --
// a moderator has to move it back to pending first).
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }

  try {
    const payload = await request.json();
    const orderId = payload?.order_id;
    const type = payload?.type;

    if (!orderId || !ATTEMPT_TYPES.includes(type)) {
      return NextResponse.json({ ok: false, error: 'order_id and a valid attempt type are required' }, { status: 400 });
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, confirmation_status, urgency_type, urgency_target_date, synced_from_sheet_at, sheet_row_number')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ ok: false, error: orderError?.message ?? 'Order not found' }, { status: 404 });
    }

    if (isTerminalConfirmationStatus(order.confirmation_status)) {
      return NextResponse.json({ ok: false, error: `Order is already ${order.confirmation_status} -- move it back to pending before logging attempts` }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin
      .from('contact_attempts')
      .select('id, count')
      .eq('order_id', orderId)
      .eq('type', type)
      .maybeSingle();

    const max = ATTEMPT_MAX[type as keyof typeof ATTEMPT_MAX];
    const previousCount = existing?.count ?? 0;

    if (previousCount >= max) {
      return NextResponse.json({ ok: false, error: `${type} is already capped at ${max}` }, { status: 400 });
    }

    const newCount = previousCount + 1;

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from('contact_attempts')
        .update({ count: newCount, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (updateError) {
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('contact_attempts')
        .insert([{ order_id: orderId, type, count: newCount, first_logged_at: new Date().toISOString() }]);
      if (insertError) {
        return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
      }
    }

    const actor = await getActor();
    await logOrderHistory(
      supabaseAdmin,
      orderId,
      [{ field: type, old_value: previousCount > 0 ? String(previousCount) : null, new_value: String(newCount) }],
      'moderator',
      actor?.name ?? null,
    );

    const { data: attemptRows } = await supabaseAdmin
      .from('contact_attempts')
      .select('type, count, first_logged_at')
      .eq('order_id', orderId);

    let sheetSyncWarning: string | undefined;
    if (order.synced_from_sheet_at && order.sheet_row_number) {
      const columnCValue = buildColumnC(order.urgency_type, order.urgency_target_date, order.confirmation_status, attemptRows ?? []);
      const writeResult = await writeColumnC(order.sheet_row_number, columnCValue);
      if (!writeResult.ok) {
        sheetSyncWarning = `Saved, but couldn't write back to the sheet: ${writeResult.error}`;
      }
    }

    return NextResponse.json({ ok: true, data: { attempts: attemptRows ?? [] }, ...(sheetSyncWarning ? { sheetSyncWarning } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
