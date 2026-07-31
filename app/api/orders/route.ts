import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

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
    const { items = [], ...orderData } = payload as { items?: Array<Record<string, unknown>>; [key: string]: unknown };

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

    const updatePayload = { ...payload };
    delete updatePayload.id;

    const { data, error } = await supabaseAdmin.from('orders').update(updatePayload).eq('id', id).select().single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
