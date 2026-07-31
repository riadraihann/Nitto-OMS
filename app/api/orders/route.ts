import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeUrgencyFields } from '@/lib/urgencyTarget.mjs';
import { buildColumnC } from '@/lib/sheetRowParser.mjs';
import { writeColumnC } from '@/lib/sheetWriteBack';
import { diffOrderFields, logOrderHistory } from '@/lib/orderHistory.mjs';

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
      ? supabaseAdmin.from('orders').select('*, order_items(*)').eq('id', id).single()
      : supabaseAdmin.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
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

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert([orderData])
      .select()
      .single();

    if (orderError || !order) {
      return NextResponse.json({ ok: false, error: orderError?.message ?? 'Unable to create order' }, { status: 500 });
    }

    const normalizedItems = (items as Array<Record<string, unknown>>)
      .filter((item) => Boolean(item?.sku || item?.product_name))
      .map((item) => ({
        order_id: order.id,
        sku: String(item.sku ?? ''),
        product_name: String(item.product_name ?? ''),
        quantity: Number(item.quantity ?? 1),
        unit_price: Number(item.unit_price ?? 0),
      }));

    if (normalizedItems.length > 0) {
      const { error: itemsError } = await supabaseAdmin.from('order_items').insert(normalizedItems);

      if (itemsError) {
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 });
      }
    }

    await logOrderHistory(
      supabaseAdmin,
      order.id,
      [{ field: 'order_created', old_value: null, new_value: `Created manually (${order.order_source})` }],
      'moderator',
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

    const normalized = normalizeUrgencyFields(rawUpdatePayload);
    if (!normalized.ok) {
      return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
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

    const changes = diffOrderFields(before, data, updatedFields);
    await logOrderHistory(supabaseAdmin, id, changes, 'moderator');

    let sheetSyncWarning: string | undefined;
    const touchedSheetSyncedField = Object.keys(normalized.payload).some((key) => SHEET_SYNCED_FIELDS.includes(key));

    // write-back only applies to orders that actually came from the sheet sync -- an order
    // created manually or via the June CSV import has no matching sheet row to write into
    if (touchedSheetSyncedField && data.synced_from_sheet_at && data.sheet_row_number) {
      const columnCValue = buildColumnC(data.urgency_type, data.urgency_target_date, data.confirmation_status);
      const writeResult = await writeColumnC(data.sheet_row_number, columnCValue);
      if (!writeResult.ok) {
        sheetSyncWarning = `Saved, but couldn't write back to the sheet: ${writeResult.error}`;
      }
    }

    return NextResponse.json({ ok: true, data, ...(sheetSyncWarning ? { sheetSyncWarning } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
